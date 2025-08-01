// FishNet Web App - Modern Version with WebGPU and Full EnglishScorer
// Matches CipherDecoders style with dark/light theme support

// Constants
const VOCAB = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,!?";
const VOCAB_SIZE = VOCAB.length;
const TOKEN_TO_IDX = Object.fromEntries(VOCAB.split("").map((c, i) => [c, i]));
const IDX_TO_TOKEN = Object.fromEntries(VOCAB.split("").map((c, i) => [i, c]));
const SEQUENCE_LENGTH = 32;
const FIXED_SEQUENCE = "fish fish fish fish fish fish it";

// CPPN Architecture
const CPPN_INPUT_SIZE = 32;
const CPPN_HIDDEN_SIZE = 128;
const CPPN_NUM_HIDDEN = 6;
const POPULATION_SIZE = 9;

// WebGPU state
let device;
let computePipeline;
let uniformBuffer;
let weightBuffer;
let biasBuffer;
let outputBuffer;
let stagingBuffer;

// Population state
let population = {
  weights: [],
  biases: [],
  sequences: [],
};

// App state
let appState = {
  evolutions: 0,
  bestScore: 0.0,
  autoSelectRunning: false,
  startTime: null,
  mutationStrength: 0.02, // Default mutation strength (matches reset value)
  fromHumanClick: false, // Flag to track if breeding came from human click
  breedingInProgress: false, // Flag to prevent multiple breeding cycles
  selectionInProgress: false, // Flag to prevent multiple rapid clicks
  initialized: false, // Flag to track if the evolve page has been initialized
  frequencyAdjustment: true, // Whether to adjust letter frequencies to match English
  learningRate: 0.02, // Learning rate for mutations (matches reset value)
  waitingForChoice: false, // Flag to track if sequences are loaded from checkpoints but not yet chosen
  sequenceEvolutionCounts: [], // Evolution counts for each sequence, waiting to be applied when chosen
  checkpointLoadingInProgress: false, // Flag to track if checkpoint loading is in progress
};

// DOM elements
let elements = {};

// Compression and decompression functions using Compression Streams API
async function compressData(data) {
  try {
    // Convert data to JSON string with error handling for circular references
    let jsonString;
    try {
      jsonString = JSON.stringify(data, null, 2);
    } catch (jsonError) {
      console.warn(
        "JSON.stringify failed, trying with replacer function:",
        jsonError
      );
      // Try with a replacer function to handle potential circular references
      const seen = new WeakSet();
      jsonString = JSON.stringify(
        data,
        (key, value) => {
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
              return "[Circular Reference]";
            }
            seen.add(value);
          }
          return value;
        },
        2
      );
    }

    // Check if the JSON string is too large
    const jsonSize = new Blob([jsonString]).size;

    if (jsonSize > 50 * 1024 * 1024) {
      // 50MB limit
      throw new Error("Checkpoint data too large for compression");
    }

    const jsonBlob = new Blob([jsonString], { type: "application/json" });

    // Create compression stream
    const compressedStream = jsonBlob
      .stream()
      .pipeThrough(new CompressionStream("gzip"));

    // Convert stream to blob
    const compressedBlob = await new Response(compressedStream).blob();

    // Check if compressed size is still too large for server protection (15MB limit)
    if (compressedBlob.size > 15 * 1024 * 1024) {
      throw new Error(
        "Compressed checkpoint too large for upload (over 15MB - server protection limit)"
      );
    }

    return compressedBlob;
  } catch (error) {
    console.error("Compression failed:", error);
    throw new Error(`Compression failed: ${error.message}`);
  }
}

async function decompressData(compressedBlob) {
  try {
    // Create decompression stream
    const decompressedStream = compressedBlob
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));

    // Convert stream to text
    const response = await new Response(decompressedStream);
    const jsonString = await response.text();

    // Parse JSON
    const data = JSON.parse(jsonString);
    return data;
  } catch (error) {
    console.error("Decompression failed:", error);
    throw new Error(`Decompression failed: ${error.message}`);
  }
}

// Check if Compression Streams API is supported
function isCompressionSupported() {
  return "CompressionStream" in window && "DecompressionStream" in window;
}

// Settings management
function initSettings() {
  // Theme management
  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return; // Theme toggle might not exist

  const currentTheme = localStorage.getItem("theme") || "dark";

  document.documentElement.setAttribute("data-theme", currentTheme);

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);

    // Update favicon
    const favicon = document.getElementById("favicon");
    if (favicon) {
      favicon.href = newTheme === "dark" ? "darkicon.png" : "lighticon.png";
    }

    // Update nav logo
    const navLogoDark = document.getElementById("nav-logo-dark");
    const navLogoLight = document.getElementById("nav-logo-light");
    if (navLogoDark && navLogoLight) {
      if (newTheme === "dark") {
        navLogoDark.style.display = "block";
        navLogoLight.style.display = "none";
      } else {
        navLogoDark.style.display = "none";
        navLogoLight.style.display = "block";
      }
    }
  });

  // Evaluation method (only on evolve page)
  const savedEvalMethod = localStorage.getItem("evalMethod") || "gemma";
  const englishCheckbox = document.getElementById("english-checkbox");
  const gemmaCheckbox = document.getElementById("gemma-checkbox");

  if (englishCheckbox && gemmaCheckbox) {
    if (savedEvalMethod === "english") {
      englishCheckbox.checked = true;
    } else {
      gemmaCheckbox.checked = true;
    }
  }

  // Frequency adjustment setting (only on evolve page)
  const savedFrequencyAdjustment =
    localStorage.getItem("frequencyAdjustment") !== null
      ? localStorage.getItem("frequencyAdjustment") === "true"
      : true; // Default to true if no saved setting
  const frequencyAdjustmentCheckbox = document.getElementById(
    "frequency-adjustment-checkbox"
  );
  if (frequencyAdjustmentCheckbox) {
    frequencyAdjustmentCheckbox.checked = savedFrequencyAdjustment;
    appState.frequencyAdjustment = savedFrequencyAdjustment;
  }

  // Learning rate setting (only on evolve page)
  const savedLearningRate =
    parseFloat(localStorage.getItem("learningRate")) || 0.02;
  const learningRateSlider = document.getElementById("learning-rate-slider");
  const learningRateValue = document.getElementById("learning-rate-value");
  if (learningRateSlider && learningRateValue) {
    learningRateSlider.value = savedLearningRate;
    learningRateValue.textContent = savedLearningRate.toFixed(3);
    appState.learningRate = savedLearningRate;
  }
}

function saveSettings() {
  // Save evaluation method (only if on evolve page)
  const evalMethod = getSelectedEvaluationMethod();
  if (evalMethod) {
    localStorage.setItem("evalMethod", evalMethod);
  }

  // Save frequency adjustment setting
  if (elements.frequencyAdjustmentCheckbox) {
    localStorage.setItem(
      "frequencyAdjustment",
      elements.frequencyAdjustmentCheckbox.checked.toString()
    );
  }

  // Save learning rate setting
  if (elements.learningRateSlider) {
    localStorage.setItem("learningRate", elements.learningRateSlider.value);
  }
}

// SPA Router
let currentRoute = "evolve";

// Initialize the SPA router
function initRouter() {
  // Get initial route from PHP or default to 'evolve'
  currentRoute = window.initialRoute || "evolve";

  // Set up navigation event listeners
  const navLinks = document.querySelectorAll(".nav-link");

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const route = link.getAttribute("data-route");
      if (route) {
        navigateTo(route);
      }
    });
  });

  // Handle browser back/forward buttons
  window.addEventListener("popstate", (event) => {
    const route = event.state?.route || "evolve";
    navigateTo(route, false); // Don't push state since browser already did
  });

  // Navigate to initial route
  navigateTo(currentRoute, false);
}

// Navigate to a specific route
function navigateTo(route, pushState = true) {
  // Don't return early if this is the initial navigation
  if (route === currentRoute && appState.initialized) return;

  // Update current route
  currentRoute = route;

  // Update URL
  if (pushState) {
    const url = route === "evolve" ? "/" : `/${route}`;
    // Only push state if the URL is actually changing
    if (window.location.pathname !== url) {
      window.history.pushState({ route }, "", url);
    }
  }

  // Update navigation active state
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("data-route") === route) {
      link.classList.add("active");
    }
  });

  // Show/hide page content
  document.querySelectorAll(".page-content").forEach((page) => {
    page.style.display = "none";
  });

  const targetPage = document.getElementById(`${route}-page`);
  if (targetPage) {
    targetPage.style.display = "block";
  }

  // Initialize evolve page if needed
  if (route === "evolve" && !appState.initialized) {
    initEvolvePage();
  }
}

// Initialize the evolve page specifically
async function initEvolvePage() {
  try {
    showLoading(true, "Initializing FishNet...");

    showLoading(true, "Loading settings...");
    initSettings();

    showLoading(true, "Setting up neural networks...");
    initPopulation();

    showLoading(true, "Configuring interface...");
    setupUI();
    // Update mutation strength after UI is set up
    if (elements.gemmaCheckbox && elements.englishCheckbox) {
      updateMutationStrength(); // Set initial mutation strength
    }

    // Check for Compression Streams API support
    if (!isCompressionSupported()) {
      console.warn(
        "Compression Streams API not supported - checkpoints will be uncompressed"
      );
      showNotification(
        "warning",
        "Compression not supported in this browser. Checkpoints will be uncompressed."
      );
    }

    // Check for checkpoints from repository
    let checkpoints = [];
    try {
      appState.checkpointLoadingInProgress = true;
      showLoading(true, "Checking for saved checkpoints...");
      checkpoints = await fetchCheckpointsFromRepo();
    } catch (error) {
      console.error(
        "Failed to fetch checkpoints, continuing with normal initialization:",
        error
      );
      showNotification(
        "warning",
        "Could not load checkpoints from repository. Starting fresh."
      );
    } finally {
      appState.checkpointLoadingInProgress = false;
    }

    if (checkpoints.length > 0) {
      // Load sequences from user checkpoints
      showLoading(
        true,
        `Loading ${checkpoints.length} checkpoint${
          checkpoints.length === 1 ? "" : "s"
        }...`
      );
      await loadSequencesFromCheckpoints(checkpoints);
    } else {
      // No checkpoints found, proceed with normal initialization
      try {
        showLoading(true, "Generating initial sequences...");
        // Use CPU generation for initial population to ensure consistency
        population.sequences = generateSequencesCPU();
      } catch (error) {
        console.warn("CPU generation failed, using fallback sequences:", error);
        population.sequences = [
          "Hello world this is a test",
          "The quick brown fox jumps",
          "Lorem ipsum dolor sit amet",
          "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
          "abcdefghijklmnopqrstuvwxyz",
          "12345678901234567890123456789012",
          "Special chars: !@#$%^&*()_+-=",
          "Mixed case and numbers 123ABC",
        ];
      }
    }

    showLoading(true, "Finalizing setup...");
    updateUI();
    showLoading(false);
    showNotification(
      "info",
      "Welcome to FishNet! Click sequences to breed or start auto-evolution."
    );

    // Debug letter frequencies for initial sequences
    debugLetterFrequencies();

    // Mark as initialized
    appState.initialized = true;
  } catch (error) {
    showLoading(false);
    showNotification("error", `Initialization failed: ${error.message}`);
    console.error("Initialization error:", error);
  }
}

// Initialize the application
async function init() {
  // Initialize the SPA router first
  initRouter();
}

// Initialize population
function initPopulation() {
  population.weights = [];
  population.biases = [];
  population.sequences = [];

  for (let i = 0; i < POPULATION_SIZE; i++) {
    const weights = generateRandomWeights();
    const biases = generateRandomBiases();

    population.weights.push(weights);
    population.biases.push(biases);
    population.sequences.push("");
  }
}

// Generate sequences using CPU (WebGPU removed)
async function generateSequences() {
  return generateSequencesCPU();
}

// CPU-based sequence generation for debugging
function generateSequencesCPU() {
  const sequences = [];

  for (let i = 0; i < POPULATION_SIZE; i++) {
    let sequence = "";
    for (let pos = 0; pos < SEQUENCE_LENGTH; pos++) {
      // Use a 32-dimensional one-hot vector for position encoding
      const x = new Float32Array(CPPN_INPUT_SIZE);
      if (pos < CPPN_INPUT_SIZE) {
        x[pos] = 1.0;
      }

      // Forward pass through the network
      let h = x;
      for (let layer = 0; layer < population.weights[i].length - 1; layer++) {
        const newH = new Float32Array(CPPN_HIDDEN_SIZE);
        for (let j = 0; j < CPPN_HIDDEN_SIZE; j++) {
          let sum = population.biases[i][layer][j];
          for (let k = 0; k < h.length; k++) {
            sum +=
              h[k] * population.weights[i][layer][k * CPPN_HIDDEN_SIZE + j];
          }
          newH[j] = Math.tanh(sum);
        }
        h = newH;
      }

      // Final layer to output
      const logits = new Float32Array(VOCAB_SIZE);
      const finalLayer = population.weights[i].length - 1;
      for (let j = 0; j < VOCAB_SIZE; j++) {
        let sum = population.biases[i][finalLayer][j];
        for (let k = 0; k < h.length; k++) {
          sum += h[k] * population.weights[i][finalLayer][k * VOCAB_SIZE + j];
        }
        logits[j] = sum;
      }

      // Softmax and sample
      const maxLogit = Math.max(...logits);
      const expLogits = logits.map((l) => Math.exp(l - maxLogit));
      const sumExp = expLogits.reduce((a, b) => a + b, 0);
      const probs = expLogits.map((e) => e / sumExp);

      // Use deterministic argmax (no randomness)
      let tokenIdx = 0;
      let maxProb = probs[0];
      for (let j = 1; j < VOCAB_SIZE; j++) {
        if (probs[j] > maxProb) {
          maxProb = probs[j];
          tokenIdx = j;
        }
      }

      sequence += IDX_TO_TOKEN[tokenIdx] || " ";
    }
    sequences.push(sequence);
  }

  return sequences;
}

// Mutate population
function mutate(
  parentIdx,
  noiseStd = null,
  parentNoiseStd = null,
  weightDecay = 0.9999
) {
  // Use learning rate from settings if not specified
  const baseNoiseStd = noiseStd || appState.learningRate;
  const baseParentNoiseStd = parentNoiseStd || appState.learningRate * 0.1;

  for (let i = 0; i < POPULATION_SIZE; i++) {
    const thisNoiseStd = i === parentIdx ? baseParentNoiseStd : baseNoiseStd;

    for (let layer = 0; layer < population.weights[i].length; layer++) {
      for (let j = 0; j < population.weights[i][layer].length; j++) {
        population.weights[i][layer][j] =
          population.weights[parentIdx][layer][j] +
          thisNoiseStd * (Math.random() - 0.5) * 2;
        population.weights[i][layer][j] *= weightDecay;
      }

      for (let j = 0; j < population.biases[i][layer].length; j++) {
        population.biases[i][layer][j] =
          population.biases[parentIdx][layer][j] +
          thisNoiseStd * (Math.random() - 0.5) * 2;
        population.biases[i][layer][j] *= weightDecay;
      }
    }
  }
}

// English Scorer Implementation (Full version matching score_english.py)
class EnglishScorer {
  constructor() {
    // Common English letter frequencies (percentage)
    this.english_freq = {
      e: 12.7,
      t: 9.1,
      a: 8.2,
      o: 7.5,
      i: 7.0,
      n: 6.7,
      s: 6.3,
      h: 6.1,
      r: 6.0,
      d: 4.3,
      l: 4.0,
      c: 2.8,
      u: 2.8,
      m: 2.4,
      w: 2.4,
      f: 2.2,
      g: 2.0,
      y: 2.0,
      p: 1.9,
      b: 1.3,
      v: 1.0,
      k: 0.8,
      j: 0.15,
      x: 0.15,
      q: 0.1,
      z: 0.07,
    };

    // Common English bigrams with frequencies
    this.common_bigrams = {
      th: 3.56,
      he: 3.07,
      in: 2.43,
      er: 2.05,
      an: 1.99,
      re: 1.85,
      ed: 1.53,
      nd: 1.45,
      on: 1.42,
      en: 1.38,
      at: 1.33,
      ou: 1.28,
      ea: 1.24,
      ha: 1.16,
      ng: 0.95,
      as: 0.87,
      or: 0.86,
      ti: 0.86,
      is: 0.86,
      et: 0.76,
      it: 0.76,
      ar: 0.69,
      te: 0.69,
      se: 0.68,
      hi: 0.68,
      of: 0.61,
      st: 0.61,
      al: 0.54,
      nt: 0.54,
      le: 0.54,
      to: 0.52,
      ur: 0.49,
      li: 0.49,
      la: 0.49,
      el: 0.43,
      ne: 0.42,
      es: 0.42,
      ro: 0.42,
      ve: 0.4,
      co: 0.4,
      ly: 0.39,
      ri: 0.38,
      de: 0.37,
      ta: 0.37,
      ic: 0.37,
      sa: 0.35,
      ec: 0.35,
      ra: 0.35,
      me: 0.34,
      om: 0.34,
      ck: 0.45,
      ow: 0.38,
      um: 0.25,
      mp: 0.22,
      ox: 0.15,
      ju: 0.12,
      ps: 0.18,
      ov: 0.2,
      az: 0.08,
      zy: 0.06,
      do: 0.35,
      og: 0.15,
    };

    // Common English words
    this.common_words = new Set([
      "the",
      "be",
      "to",
      "of",
      "and",
      "a",
      "in",
      "that",
      "have",
      "i",
      "it",
      "for",
      "not",
      "on",
      "with",
      "he",
      "as",
      "you",
      "do",
      "at",
      "this",
      "but",
      "his",
      "by",
      "from",
      "they",
      "we",
      "say",
      "her",
      "she",
      "or",
      "an",
      "will",
      "my",
      "one",
      "all",
      "would",
      "there",
      "their",
      "what",
      "so",
      "up",
      "out",
      "if",
      "about",
      "who",
      "get",
      "which",
      "go",
      "me",
      "when",
      "make",
      "can",
      "like",
      "time",
      "no",
      "just",
      "him",
      "know",
      "take",
      "people",
      "into",
      "year",
      "your",
      "good",
      "some",
      "could",
      "them",
      "see",
      "other",
      "than",
      "then",
      "now",
      "look",
      "only",
      "come",
      "its",
      "over",
      "think",
      "also",
      "back",
      "after",
      "use",
      "two",
      "how",
      "our",
      "work",
      "first",
      "well",
      "way",
      "even",
      "new",
      "want",
      "because",
      "any",
      "these",
      "give",
      "day",
      "most",
      "us",
      "quick",
      "brown",
      "fox",
      "jumps",
      "lazy",
      "dog",
      "hello",
      "world",
      "test",
      "sentence",
      "is",
      "word",
      "words",
      "language",
      "english",
      "check",
      "score",
    ]);

    // Basic English dictionary
    this.english_words = new Set([
      "the",
      "quick",
      "brown",
      "fox",
      "jumps",
      "over",
      "lazy",
      "dog",
      "hello",
      "world",
      "this",
      "test",
      "sentence",
      "random",
      "text",
      "gibberish",
      "example",
      "sample",
      "word",
      "words",
      "language",
      "english",
      "check",
      "score",
      "analysis",
      "frequency",
      "pattern",
    ]);

    // Add common words to dictionary
    this.english_words = new Set([...this.english_words, ...this.common_words]);
  }

  letter_frequency_score(text) {
    if (!text) return 0.0;

    const letters_only = text.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (!letters_only || letters_only.length < 10) return 0.7;

    const text_freq = {};
    for (const letter of letters_only) {
      text_freq[letter] = (text_freq[letter] || 0) + 1;
    }

    const total_letters = letters_only.length;
    let dot_product = 0;
    let magnitude_text = 0;
    let magnitude_english = 0;

    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const text_percent = ((text_freq[letter] || 0) / total_letters) * 100;
      const english_percent = this.english_freq[letter] || 0;

      dot_product += text_percent * english_percent;
      magnitude_text += text_percent * text_percent;
      magnitude_english += english_percent * english_percent;
    }

    magnitude_text = Math.sqrt(magnitude_text);
    magnitude_english = Math.sqrt(magnitude_english);

    if (magnitude_text === 0 || magnitude_english === 0) return 0.0;

    const similarity = dot_product / (magnitude_text * magnitude_english);

    if (similarity > 0.8) {
      return Math.min(1.0, similarity * 1.05);
    }

    return Math.max(0.0, Math.min(1.0, similarity));
  }

  bigram_score(text) {
    if (text.length < 2) return 0.0;

    const words = text.match(/[a-zA-Z]+/g) || [];
    if (!words.length) return 0.0;

    const all_bigrams = [];
    const word_boundary_bigrams = [];

    // Collect bigrams from within words
    for (const word of words) {
      if (word.length >= 2) {
        for (let i = 0; i < word.length - 1; i++) {
          all_bigrams.push(word.substring(i, i + 2));
        }
      }
    }

    // Collect cross-word bigrams
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] && words[i + 1]) {
        const cross_bigram = words[i].slice(-1) + words[i + 1][0];
        word_boundary_bigrams.push(cross_bigram);
      }
    }

    const total_bigrams = [...all_bigrams, ...word_boundary_bigrams];
    if (!total_bigrams.length) return 0.0;

    // Count common bigrams
    const common_count = total_bigrams.filter(
      (bg) => bg in this.common_bigrams
    ).length;
    const base_score = common_count / total_bigrams.length;

    // Apply frequency weighting
    let weighted_score = 0;
    let total_weight = 0;

    for (const bigram of total_bigrams) {
      if (bigram in this.common_bigrams) {
        const weight = this.common_bigrams[bigram];
        weighted_score += weight;
      } else {
        weighted_score += 0.1;
      }
      total_weight += Math.max(0.1, this.common_bigrams[bigram] || 0.1);
    }

    const normalized_weighted_score =
      total_weight > 0 ? weighted_score / total_weight : 0;
    const final_score = base_score * 0.4 + normalized_weighted_score * 0.6;

    if (base_score >= 0.3 && base_score <= 0.7) {
      return Math.min(1.0, final_score * 1.1);
    }

    return final_score;
  }

  vocabulary_score(text) {
    const words = text.match(/[a-zA-Z]+/g) || [];
    if (!words.length) return 0.0;

    const common_count = words.filter((word) =>
      this.common_words.has(word.toLowerCase())
    ).length;
    const common_ratio = common_count / words.length;

    const valid_count = words.filter((word) =>
      this.english_words.has(word.toLowerCase())
    ).length;
    const valid_ratio = valid_count / words.length;

    const combined_score = common_ratio * 0.4 + valid_ratio * 0.6;

    if (valid_ratio >= 0.8 && common_ratio >= 0.5) {
      return Math.min(1.0, combined_score * 1.15);
    } else if (valid_ratio >= 0.9) {
      return Math.min(1.0, combined_score * 1.1);
    }

    return combined_score;
  }

  structural_score(text) {
    if (!text) return 0.0;

    const scores = [];

    // Vowel to consonant ratio
    const letters = text.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (letters) {
      const vowels = letters
        .split("")
        .filter((c) => "aeiou".includes(c)).length;
      const vowel_ratio = vowels / letters.length;
      if (vowel_ratio >= 0.2 && vowel_ratio <= 0.6) {
        scores.push(1.0 - Math.abs(vowel_ratio - 0.4) * 1.5);
      } else {
        scores.push(Math.max(0, 1.0 - Math.abs(vowel_ratio - 0.4) * 2.5));
      }
    }

    // Word length distribution
    const words = text.match(/[a-zA-Z]+/g) || [];
    if (words.length) {
      const avg_word_length =
        words.reduce((sum, word) => sum + word.length, 0) / words.length;
      if (avg_word_length >= 2 && avg_word_length <= 8) {
        const length_score = 1 - Math.abs(avg_word_length - 4.5) / 5;
        scores.push(Math.max(0, length_score));
      } else {
        const length_score = Math.max(
          0,
          1 - Math.abs(avg_word_length - 4.5) / 10
        );
        scores.push(length_score);
      }
    }

    // Space ratio
    if (text.length > 0) {
      const space_ratio = (text.match(/ /g) || []).length / text.length;
      if (space_ratio >= 0.1 && space_ratio <= 0.25) {
        scores.push(1.0);
      } else {
        const space_score = Math.max(0, 1 - Math.abs(space_ratio - 0.17) * 3);
        scores.push(space_score);
      }
    }

    return scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0.0;
  }

  calculate_english_score(text) {
    const letters_only = text.replace(/[^a-zA-Z]/g, "");
    const text_length = letters_only.length;

    // Dynamic weighting based on text length
    let freq_weight, vocab_weight, bigram_weight, struct_weight;

    if (text_length < 20) {
      freq_weight = 0.1;
      vocab_weight = 0.45;
      bigram_weight = 0.25;
      struct_weight = 0.2;
    } else if (text_length < 50) {
      freq_weight = 0.15;
      vocab_weight = 0.4;
      bigram_weight = 0.25;
      struct_weight = 0.2;
    } else {
      freq_weight = 0.25;
      vocab_weight = 0.35;
      bigram_weight = 0.25;
      struct_weight = 0.15;
    }

    const freq_score = this.letter_frequency_score(text);
    const bigram_score = this.bigram_score(text);
    const vocab_score = this.vocabulary_score(text);
    const struct_score = this.structural_score(text);

    const overall_score =
      freq_score * freq_weight +
      bigram_score * bigram_weight +
      vocab_score * vocab_weight +
      struct_score * struct_weight;

    // Apply final boost for high-quality English text
    if (vocab_score > 0.9 && struct_score > 0.8) {
      return Math.min(0.98, overall_score * 1.08);
    } else if (vocab_score > 0.8 && struct_score > 0.7) {
      return Math.min(0.95, overall_score * 1.05);
    }

    return overall_score;
  }
}

// Create global EnglishScorer instance
const englishScorer = new EnglishScorer();

// Evaluation functions
function levenshteinSimilarity(s, ref = FIXED_SEQUENCE) {
  if (s === ref) return 1.0;
  if (s.length === 0) return ref.length === 0 ? 1.0 : 0.0;
  if (ref.length === 0) return 0.0;

  const v0 = Array(ref.length + 1)
    .fill(0)
    .map((_, i) => i);
  const v1 = Array(ref.length + 1).fill(0);

  for (let i = 0; i < s.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < ref.length; j++) {
      const cost = s[i] === ref[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    [v0, v1] = [v1, v0];
  }

  const dist = v0[ref.length];
  const maxLen = Math.max(s.length, ref.length);
  return maxLen === 0 ? 1.0 : 1 - dist / maxLen;
}

function calculateEnglishScore(text) {
  return englishScorer.calculate_english_score(text);
}

// Evaluation methods
async function evaluateWithGemma() {
  try {
    const choicesText = population.sequences
      .map((seq, i) => `${i + 1}. ${seq}`)
      .join("\n");
    const query = `Which of these sequences are most interesting to you:\n\n${choicesText}\n\nOutput ONLY the number corresponding to the most interesting one.`;

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemma3:1b",
        prompt: query,
        stream: false,
        options: {
          num_predict: 16,
          temperature: 0.8,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const text = data.response || "1";

    // Extract number from response
    const match = text.match(/\b(\d+)\b/);
    let chosen = match ? parseInt(match[1]) - 1 : 0;
    chosen = Math.max(0, Math.min(chosen, population.sequences.length - 1));

    return chosen;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    showNotification(
      "warning",
      "Ollama API failed, falling back to English scoring"
    );

    // Fallback to English scoring
    const scores = population.sequences.map((seq) =>
      calculateEnglishScore(seq)
    );
    const maxScore = Math.max(...scores);
    const candidates = scores
      .map((score, i) => ({ score, i }))
      .filter((item) => item.score === maxScore);
    return candidates[Math.floor(Math.random() * candidates.length)].i;
  }
}

function evaluateWithEnglish() {
  const scores = population.sequences.map((seq) => calculateEnglishScore(seq));
  const maxScore = Math.max(...scores);
  const candidates = scores
    .map((score, i) => ({ score, i }))
    .filter((item) => item.score === maxScore);
  return candidates[Math.floor(Math.random() * candidates.length)].i;
}

// UI Functions
function setupUI() {
  elements = {
    autoButton: document.getElementById("auto-button"),
    saveButton: document.getElementById("save-button"),
    loadButton: document.getElementById("load-button"),
    resetButton: document.getElementById("reset-button"),
    wowButton: document.getElementById("wow-button"),
    cancelLoadingButton: document.getElementById("cancel-loading-button"),
    gemmaCheckbox: document.getElementById("gemma-checkbox"),
    englishCheckbox: document.getElementById("english-checkbox"),
    frequencyAdjustmentCheckbox: document.getElementById(
      "frequency-adjustment-checkbox"
    ),
    learningRateSlider: document.getElementById("learning-rate-slider"),
    learningRateValue: document.getElementById("learning-rate-value"),
    sequencesGrid: document.getElementById("sequences-grid"),
    evolutionsValue: document.getElementById("evolutions-value"),
    epsValue: document.getElementById("eps-value"),

    populationSizeValue: document.getElementById("population-size-value"),
  };

  // Check if we're on the evolve page (elements might not exist on other pages)
  if (!elements.autoButton) {
    return;
  }

  // Verify all required elements exist
  const requiredElements = [
    "autoButton",
    "saveButton",
    "loadButton",
    "resetButton",
    "wowButton",
    "gemmaCheckbox",
    "englishCheckbox",
    "sequencesGrid",
    "evolutionsValue",
    "epsValue",
    "populationSizeValue",
  ];

  for (const elementName of requiredElements) {
    if (!elements[elementName]) {
      console.error(`Required element not found: ${elementName}`);
      throw new Error(`Required element not found: ${elementName}`);
    }
  }

  // Event listeners
  elements.autoButton.addEventListener("click", toggleAutoSelect);
  elements.saveButton.addEventListener("click", saveCheckpoint);
  elements.loadButton.addEventListener("click", loadCheckpoint);
  elements.resetButton.addEventListener("click", resetPopulation);
  elements.wowButton.addEventListener("click", uploadCheckpointToRepo);

  // Cancel loading button event listener
  if (elements.cancelLoadingButton) {
    elements.cancelLoadingButton.addEventListener("click", cancelCheckpointLoading);
  }

  // Radio button event listeners for evaluation methods
  elements.gemmaCheckbox.addEventListener("change", () => {
    onEvaluationMethodChanged();
    saveSettings();
  });
  elements.englishCheckbox.addEventListener("change", () => {
    onEvaluationMethodChanged();
    saveSettings();
  });

  // Frequency adjustment checkbox event listener
  if (elements.frequencyAdjustmentCheckbox) {
    elements.frequencyAdjustmentCheckbox.addEventListener("change", () => {
      appState.frequencyAdjustment =
        elements.frequencyAdjustmentCheckbox.checked;
      saveSettings();
    });
  }

  // Learning rate slider event listener
  if (elements.learningRateSlider && elements.learningRateValue) {
    elements.learningRateSlider.addEventListener("input", () => {
      const value = parseFloat(elements.learningRateSlider.value);
      elements.learningRateValue.textContent = value.toFixed(3);
      appState.learningRate = value;
      updateMutationStrength(); // Update mutation strength when learning rate changes
      saveSettings();
    });
  }

  // Reset learning rate button event listener
  const resetLearningRateButton = document.getElementById(
    "reset-learning-rate-button"
  );
  if (
    resetLearningRateButton &&
    elements.learningRateSlider &&
    elements.learningRateValue
  ) {
    resetLearningRateButton.addEventListener("click", () => {
      const resetValue = 0.02;
      elements.learningRateSlider.value = resetValue;
      elements.learningRateValue.textContent = resetValue.toFixed(3);
      appState.learningRate = resetValue;
      updateMutationStrength(); // Update mutation strength when learning rate changes
      saveSettings();
    });
  }

  // Initialize with default selection
  onEvaluationMethodChanged();

  // Add event delegation for sequence clicks
  if (elements.sequencesGrid) {
    elements.sequencesGrid.addEventListener("click", (event) => {
      const card = event.target.closest(".sequence-card");
      if (card && card.dataset.index !== undefined) {
        const index = parseInt(card.dataset.index);
        // Show immediate feedback
        card.style.opacity = "0.7";

        // Use chunked processing to avoid long setTimeout handlers
        processSequenceSelection(index);
      }
    });
  }

  // Make radio-item and checkbox-item divs clickable
  document.addEventListener("click", (event) => {
    const radioItem = event.target.closest(".radio-item");
    if (radioItem) {
      const radioInput = radioItem.querySelector('input[type="radio"]');
      if (radioInput && !radioInput.checked) {
        radioInput.checked = true;
        radioInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    const checkboxItem = event.target.closest(".checkbox-item");
    if (checkboxItem) {
      const checkboxInput = checkboxItem.querySelector(
        'input[type="checkbox"]'
      );
      if (checkboxInput) {
        checkboxInput.checked = !checkboxInput.checked;
        checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  });
}

function onEvaluationMethodChanged() {
  // Only update if we're on the evolve page
  if (elements.gemmaCheckbox && elements.englishCheckbox) {
    updateMutationStrength();
  }
}

function getSelectedEvaluationMethod() {
  // Safety check: ensure elements are initialized
  if (!elements.gemmaCheckbox || !elements.englishCheckbox) {
    return null; // return null if not on evolve page
  }

  if (elements.gemmaCheckbox.checked) return "gemma";
  if (elements.englishCheckbox.checked) return "english";
  return "manual"; // default fallback
}

function updateMutationStrength() {
  // Learning rate IS the mutation strength - no presets!
  appState.mutationStrength = appState.learningRate;
}

function toggleAutoSelect() {
  // Update state immediately
  if (!appState.autoSelectRunning) {
    appState.autoSelectRunning = true;
    appState.startTime = appState.startTime || Date.now();
    // Defer UI updates to next tick
    setTimeout(() => {
      elements.autoButton.querySelector(".button-text").textContent =
        "Stop Auto-Evolution";
      elements.autoButton.querySelector("i").className = "fas fa-stop";
      elements.autoButton.classList.add("running");
      startAutoEvolution();
    }, 0);
  } else {
    appState.autoSelectRunning = false;
    // Defer UI updates to next tick
    setTimeout(() => {
      elements.autoButton.querySelector(".button-text").textContent =
        "Start Auto-Evolution";
      elements.autoButton.querySelector("i").className = "fas fa-play";
      elements.autoButton.classList.remove("running");
    }, 0);
  }
}

async function startAutoEvolution() {
  if (!appState.autoSelectRunning) {
    return;
  }

  const chosen = await selectBestSequence();

  if (chosen === -1) {
    // Auto-evolution not supported for this method
    appState.autoSelectRunning = false;
    elements.autoButton.querySelector(".button-text").textContent =
      "Start Auto-Evolution";
    elements.autoButton.querySelector("i").className = "fas fa-play";
    elements.autoButton.classList.remove("running");
    return;
  }

  await breedAndUpdate(chosen);

  appState.evolutions++;
  updateUI();

  // Debug letter frequencies after auto-evolution
  debugLetterFrequencies();

  if (appState.autoSelectRunning) {
    setTimeout(startAutoEvolution, 100);
  }
}

async function selectBestSequence() {
  const evalMethod = getSelectedEvaluationMethod();

  if (evalMethod === "gemma") {
    return await evaluateWithGemma();
  } else if (evalMethod === "english") {
    return evaluateWithEnglish();
  } else {
    return Math.floor(Math.random() * POPULATION_SIZE);
  }
}

// Chunked breeding to avoid long setTimeout handlers
function chunkedBreedAndUpdate(parentIdx, onComplete) {
  // Prevent multiple breeding cycles from running simultaneously
  if (appState.breedingInProgress) {
    return;
  }
  appState.breedingInProgress = true;

  const evalMethod = getSelectedEvaluationMethod();

  // Store the chosen parent network (this will be our new "parent")
  const chosenWeights = population.weights[parentIdx].map((w) => {
    const copy = new Float32Array(w.length);
    copy.set(w);
    return copy;
  });
  const chosenBiases = population.biases[parentIdx].map((b) => {
    const copy = new Float32Array(b.length);
    copy.set(b);
    return copy;
  });
  const chosenSequence = population.sequences[parentIdx];

  // For score-based methods, store the parent's score for comparison
  let parentScoreBefore = 0;
  if (evalMethod === "english") {
    parentScoreBefore = calculateEnglishScore(chosenSequence);
  }

  // Step 1: Clear population (fast)
  population.weights = [];
  population.biases = [];

  // Step 2: Copy parent networks in chunks
  let currentIndex = 0;
  const chunkSize = 2; // Process 2 networks at a time

  function copyNextChunk() {
    const endIndex = Math.min(currentIndex + chunkSize, POPULATION_SIZE);

    for (let i = currentIndex; i < endIndex; i++) {
      population.weights[i] = chosenWeights.map((w) => {
        const copy = new Float32Array(w.length);
        copy.set(w);
        return copy;
      });
      population.biases[i] = chosenBiases.map((b) => {
        const copy = new Float32Array(b.length);
        copy.set(b);
        return copy;
      });
    }

    currentIndex = endIndex;

    if (currentIndex < POPULATION_SIZE) {
      // Continue with next chunk
      setTimeout(copyNextChunk, 0);
    } else {
      // All copies done, start mutations
      mutateNextChunk();
    }
  }

  // Step 3: Apply mutations in chunks
  let mutationIndex = 0;

  function mutateNextChunk() {
    const endIndex = Math.min(mutationIndex + chunkSize, POPULATION_SIZE);

    for (let i = mutationIndex; i < endIndex; i++) {
      for (let layer = 0; layer < population.weights[i].length; layer++) {
        // Mutate weights
        for (let j = 0; j < population.weights[i][layer].length; j++) {
          const noise = (Math.random() - 0.5) * 2 * appState.mutationStrength;
          population.weights[i][layer][j] += noise;
        }
        // Mutate biases
        for (let j = 0; j < population.biases[i][layer].length; j++) {
          const noise = (Math.random() - 0.5) * 2 * appState.mutationStrength;
          population.biases[i][layer][j] += noise;
        }
      }
    }

    mutationIndex = endIndex;

    if (mutationIndex < POPULATION_SIZE) {
      // Continue with next chunk
      setTimeout(mutateNextChunk, 0);
    } else {
      // All mutations done, generate sequences
      generateSequencesChunked(onComplete, parentScoreBefore, evalMethod);
    }
  }

  // Start the chunked process
  copyNextChunk();
}

// Chunked sequence generation
function generateSequencesChunked(onComplete, parentScoreBefore, evalMethod) {
  // Generate sequences in chunks
  const cpuSequences = generateSequencesCPU();
  population.sequences = cpuSequences;

  // Update UI immediately
  updateUI();

  // Handle score-based evaluation in next tick
  setTimeout(() => {
    if (evalMethod === "english") {
      const newScores = population.sequences.map((seq) =>
        calculateEnglishScore(seq)
      );
      const newBestScore = Math.max(...newScores);

      // If all mutations are worse than the original parent, revert and create new mutations
      if (newBestScore < parentScoreBefore) {
        // For now, just continue - could implement revert logic later
      }

      // Update best score if we have a new best
      if (newBestScore > appState.bestScore) {
        appState.bestScore = newBestScore;
      }
    }

    appState.breedingInProgress = false;
    onComplete();
  }, 0);
}

async function breedAndUpdate(parentIdx) {
  // Legacy function - now handled by chunkedBreedAndUpdate
  return new Promise((resolve) => {
    chunkedBreedAndUpdate(parentIdx, resolve);
  });
}

// Chunked processing to avoid long setTimeout handlers
function processSequenceSelection(index) {
  // Step 1: Immediate state updates (fast)
  if (appState.selectionInProgress) {
    return;
  }
  appState.selectionInProgress = true;

  appState.fromHumanClick = true;

  const wasAutoRunning = appState.autoSelectRunning;
  if (wasAutoRunning) {
    appState.autoSelectRunning = false;
    elements.autoButton.querySelector(".button-text").textContent =
      "Start Auto-Evolution";
    elements.autoButton.querySelector("i").className = "fas fa-play";
    elements.autoButton.classList.remove("running");
  }

  // Step 2: Use chunked breeding to avoid long setTimeout handlers
  // Start chunked breeding process
  chunkedBreedAndUpdate(index, () => {
    // Step 3: Post-breeding updates

    // Apply evolution count from the specific sequence that was chosen
    if (
      appState.waitingForChoice &&
      appState.sequenceEvolutionCounts.length > index
    ) {
      const chosenSequenceEvolutionCount =
        appState.sequenceEvolutionCounts[index];
      appState.evolutions = chosenSequenceEvolutionCount;
      appState.waitingForChoice = false;
      appState.sequenceEvolutionCounts = [];
    }

    appState.evolutions++;

    // Remove checkpoint message when user interacts
    const messageContainer = document.getElementById("checkpoint-message");
    if (messageContainer) {
      messageContainer.remove();
    }
    
    // Re-enable the "I think I found something cool!" button when user interacts
    if (elements.wowButton) {
      elements.wowButton.disabled = false;
      elements.wowButton.style.opacity = "1";
      elements.wowButton.style.cursor = "pointer";
      elements.wowButton.title = "";
    }

    updateUI();

    // Debug letter frequencies after breeding
    debugLetterFrequencies();

    // Restart auto-evolution if it was running
    if (wasAutoRunning) {
      appState.autoSelectRunning = true;
      elements.autoButton.querySelector(".button-text").textContent =
        "Stop Auto-Evolution";
      elements.autoButton.querySelector("i").className = "fas fa-stop";
      elements.autoButton.classList.add("running");
      startAutoEvolution();
    }
    appState.selectionInProgress = false;

    // Restore card opacity
    const card = document.querySelector(`[data-index="${index}"]`);
    if (card) card.style.opacity = "1";
  });
}

async function selectSequence(index) {
  // Legacy function - now handled by processSequenceSelection
  processSequenceSelection(index);
}

function manualGenerateSequences() {
  // Show immediate feedback
  showNotification("info", "Generating sequences...");

  // Defer heavy generation work
  setTimeout(() => {
    generateSequences()
      .then(() => {
        updateUI();
        showNotification("success", "Sequences generated successfully!");
      })
      .catch((error) => {
        console.error("Manual generation failed:", error);
        showNotification("error", `Generation failed: ${error.message}`);
      });
  }, 10);
}

function updateUI() {
  // Only update if we're on the evolve page
  if (!elements.autoButton) return;

  // Update stats immediately (light operation)
  updateStats();

  // Defer heavy DOM operations to next frame
  requestAnimationFrame(() => {
    updateSequencesGrid();
  });
}

function updateSequencesGrid() {
  if (!elements.sequencesGrid) return; // Not on evolve page

  if (!population.sequences || population.sequences.length === 0) {
    elements.sequencesGrid.innerHTML =
      '<div class="info">No sequences available. Generating...</div>';
    return;
  }

  // Use DocumentFragment for better performance (single DOM operation)
  const fragment = document.createDocumentFragment();

  population.sequences.forEach((sequence, index) => {
    const card = document.createElement("div");
    card.className = "sequence-card";
    card.dataset.index = index;

    const text = document.createElement("div");
    text.className = "sequence-text";
    text.textContent = sequence;

    card.appendChild(text);
    fragment.appendChild(card);
  });

  // Single DOM operation instead of multiple appendChild calls
  elements.sequencesGrid.innerHTML = "";
  elements.sequencesGrid.appendChild(fragment);
}

function updateStats() {
  if (!elements.evolutionsValue) return; // Not on evolve page

  // Show "N/A" if waiting for user to choose from loaded checkpoints
  if (appState.waitingForChoice) {
    elements.evolutionsValue.textContent = "N/A";
  } else {
    elements.evolutionsValue.textContent = appState.evolutions;
  }

  if (appState.startTime) {
    const elapsed = (Date.now() - appState.startTime) / 1000;
    const eps = elapsed > 0 ? appState.evolutions / elapsed : 0;
    elements.epsValue.textContent = eps.toFixed(1);
  }


  elements.populationSizeValue.textContent = POPULATION_SIZE;
}

function showLoading(show, message = "Initializing...") {
  const loading = document.getElementById("loading");
  if (!loading) return; // Loading element might not exist on all pages

  const loadingText = loading.querySelector("p");

  if (show) {
    loadingText.textContent = message;
    loading.classList.remove("hidden");

    // Disable the "I think I found something cool!" button while loading
    if (elements.wowButton) {
      elements.wowButton.disabled = true;
      elements.wowButton.style.opacity = "0.5";
      elements.wowButton.style.cursor = "not-allowed";
      // Set appropriate tooltip based on state
      if (appState.waitingForChoice) {
        elements.wowButton.title = "Please choose a sequence before uploading to GitHub";
      } else {
        elements.wowButton.title = "GitHub checkpoint loading in progress...";
      }
    }

    // Show cancel button and disable main buttons during checkpoint loading
    if (appState.checkpointLoadingInProgress) {
      if (elements.cancelLoadingButton) {
        elements.cancelLoadingButton.style.display = "block";
      }
      
      if (elements.autoButton) {
        elements.autoButton.disabled = true;
        elements.autoButton.style.opacity = "0.5";
        elements.autoButton.style.cursor = "not-allowed";
        elements.autoButton.title = "GitHub checkpoint loading in progress...";
      }
      if (elements.saveButton) {
        elements.saveButton.disabled = true;
        elements.saveButton.style.opacity = "0.5";
        elements.saveButton.style.cursor = "not-allowed";
        elements.saveButton.title = "GitHub checkpoint loading in progress...";
      }

      if (elements.resetButton) {
        elements.resetButton.disabled = true;
        elements.resetButton.style.opacity = "0.5";
        elements.resetButton.style.cursor = "not-allowed";
        elements.resetButton.title = "GitHub checkpoint loading in progress...";
      }
    }
  } else {
    loading.classList.add("hidden");

    // Re-enable the "I think I found something cool!" button when loading is done
    // But only if we're not waiting for user choice from GitHub checkpoints
    if (elements.wowButton && !appState.waitingForChoice) {
      elements.wowButton.disabled = false;
      elements.wowButton.style.opacity = "1";
      elements.wowButton.style.cursor = "pointer";
      elements.wowButton.title = "";
    }

    // Hide cancel button and re-enable main buttons when loading is done
    if (elements.cancelLoadingButton) {
      elements.cancelLoadingButton.style.display = "none";
    }
    
    if (elements.autoButton) {
      elements.autoButton.disabled = false;
      elements.autoButton.style.opacity = "1";
      elements.autoButton.style.cursor = "pointer";
      elements.autoButton.title = "";
    }
    if (elements.saveButton) {
      elements.saveButton.disabled = false;
      elements.saveButton.style.opacity = "1";
      elements.saveButton.style.cursor = "pointer";
      elements.saveButton.title = "";
    }

    if (elements.resetButton) {
      elements.resetButton.disabled = false;
      elements.resetButton.style.opacity = "1";
      elements.resetButton.style.cursor = "pointer";
      elements.resetButton.title = "";
    }
  }
}

function showNotification(type, message, duration = 4000) {
  const container = document.getElementById("notification-container");
  if (!container) return; // Notification container might not exist

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  
  // Check if message contains HTML
  if (message.includes('<')) {
    notification.innerHTML = message;
  } else {
    notification.textContent = message;
  }

  container.appendChild(notification);

  // Trigger animation
  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  // Auto-remove after specified duration
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      if (container.contains(notification)) {
        container.removeChild(notification);
      }
    }, 300);
  }, duration);

  // Click to dismiss
  notification.addEventListener("click", () => {
    notification.classList.remove("show");
    setTimeout(() => {
      if (container.contains(notification)) {
        container.removeChild(notification);
      }
    }, 300);
  });
}

// Function to cancel checkpoint loading
function cancelCheckpointLoading() {
  if (confirm("Are you sure you want to cancel loading checkpoints from GitHub? This will start with fresh random sequences.")) {
    // Cancel the loading process
    appState.checkpointLoadingInProgress = false;
    appState.waitingForChoice = false;
    appState.sequenceEvolutionCounts = [];

    // Remove checkpoint message if it exists
    const messageContainer = document.getElementById("checkpoint-message");
    if (messageContainer) {
      messageContainer.remove();
    }

    // Reset to fresh population
    initPopulation();
    appState.evolutions = 0;
    appState.bestScore = 0.0;
    appState.startTime = null;

    // Generate new sequences
    try {
      population.sequences = generateSequencesCPU();
      updateUI();
      showNotification("info", "Checkpoint loading cancelled. Population reset to fresh sequences!");
      // Show debug print after reset
      debugLetterFrequencies();
    } catch (error) {
      console.error("Error generating sequences after cancel:", error);
      showNotification("error", "Failed to generate sequences after cancel");
    }

    // Hide loading and re-enable buttons
    showLoading(false);
  }
}

// Checkpoint functions
async function saveCheckpoint() {
  try {
    // Get current evaluation method
    const evalMethod = getSelectedEvaluationMethod();

    const data = {
      // Current sequences displayed
      sequences: population.sequences,

      // Neural network weights and biases
      population: {
        weights: population.weights.map((w) => w.map((arr) => Array.from(arr))),
        biases: population.biases.map((b) => b.map((arr) => Array.from(arr))),
      },

      // App state including evolution count and settings
      appState: {
        evolutions: appState.evolutions,
        startTime: appState.startTime,
        mutationStrength: appState.mutationStrength,
        frequencyAdjustment: appState.frequencyAdjustment,
        learningRate: appState.learningRate,
      },

      // Evaluation method
      evaluationMethod: evalMethod,

      // Metadata
      timestamp: Date.now(),
      version: "1.0",
      dateCreated: new Date().toISOString(),
    };

    let blob, filename;

    // Check if compression is supported and use it for local saves too
    if (isCompressionSupported()) {
      blob = await compressData(data);
      const date = new Date().toLocaleDateString().replace(/\//g, '-');
      const time = new Date().toLocaleTimeString().replace(/:/g, '.');
      filename = `FishNet ckpt on ${date}, ${time}, ${appState.evolutions} evolutions.json.gz`;
    } else {
      // Fallback to uncompressed JSON
      blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const date = new Date().toLocaleDateString().replace(/\//g, '-');
      const time = new Date().toLocaleTimeString().replace(/:/g, '.');
      filename = `FishNet ckpt on ${date}, ${time}, ${appState.evolutions} evolutions.json`;
    }

    // Create download link and trigger it
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    const compressionStatus = isCompressionSupported() ? " (compressed)" : "";
    showNotification(
      "success",
      `Checkpoint saved! ${
        appState.evolutions
      } evolutions${compressionStatus}`
    );
  } catch (error) {
    console.error("Error saving checkpoint:", error);
    showNotification("error", `Failed to save checkpoint: ${error.message}`);
  }
}

// Function to test PHP handler

// Helper function for retry logic with exponential backoff
async function fetchWithRetry(url, options = {}, maxRetries = 4) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default to 60 seconds


        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue; // Retry immediately after waiting
      }

      // Handle server errors (5xx) with exponential backoff
      if (response.status >= 500 && response.status < 600) {
        if (attempt < maxRetries) {
          const backoffTime = Math.min(250 * Math.pow(2, attempt), 8000); // Start at 250ms, max 8s

          await new Promise((resolve) => setTimeout(resolve, backoffTime));
          continue;
        }
      }

      // For other errors or successful responses, return immediately
      return response;
    } catch (error) {
      lastError = error;

      // For network errors, retry with exponential backoff
      if (attempt < maxRetries) {
        const backoffTime = Math.min(250 * Math.pow(2, attempt), 8000);

        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        continue;
      }
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error("All retry attempts failed");
}

// Function to fetch checkpoints from repository
async function fetchCheckpointsFromRepo() {
  try {
    // Check if loading was cancelled
    if (!appState.checkpointLoadingInProgress) {
      return [];
    }

    const response = await fetchWithRetry(
      "./upload_handler.php?action=file-status&path=checkpoints",
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`HTTP error! status: ${response.status}`);
      console.error("Full error response:", errorText);
      throw new Error(`Server error ${response.status}: ${errorText}`);
    }

    const responseText = await response.text();

    // Check if response is valid JSON
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Invalid JSON response from server:");
      console.error("Response text:", responseText);
      console.error("Parse error:", parseError);
      throw new Error(`Invalid JSON response: ${parseError.message}`);
    }

    if (!result.success) {
      console.error("Server returned error:", result.error || "Unknown error");
      throw new Error(`Server error: ${result.error || "Unknown error"}`);
    }

    if (!result.exists) {
      return []; // No checkpoints directory exists
    }

    // Check if it's a directory listing
    if (result.type === "directory") {
      // Parse the directory contents to get checkpoint files
      const files = result.files || [];
      const checkpoints = [];

      for (const file of files) {
        if (
          file.name &&
          (file.name.endsWith(".json") || file.name.endsWith(".json.gz"))
        ) {
          // Parse filename to extract timestamp and evolution count (handle both .json and .json.gz)
          const match = file.name.match(/^(\d+)_(\d+)\.(json|json\.gz)$/);
          if (match) {
            const timestamp = parseInt(match[1]);
            const evolutions = parseInt(match[2]);
            const extension = match[3];
            checkpoints.push({
              name: file.name,
              timestamp: timestamp,
              evolutions: evolutions,
              size: file.size,
              sha: file.sha,
              isCompressed: extension === "json.gz",
            });
          } else {
            console.warn("File doesn't match pattern:", file.name);
          }
        }
      }

      // Sort by evolution count (highest first) and return top 9
      return checkpoints.sort((a, b) => b.evolutions - a.evolutions).slice(0, 9);
    }

    // If not a directory or no files found, return empty array
    return [];
  } catch (error) {
    console.error("Error fetching checkpoints:", error.message);
    console.error("Full error:", error);
    throw error; // Re-throw to see the actual error
  }
}

// Function to load a checkpoint from repository
async function loadCheckpointFromRepo(filename) {
  try {
    // Check if loading was cancelled
    if (!appState.checkpointLoadingInProgress) {
      throw new Error("Loading cancelled");
    }

    const response = await fetchWithRetry(
      `./upload_handler.php?action=download-file&path=checkpoints/${filename}`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || "Failed to load checkpoint");
    }

    // Check if the file is compressed
    const isCompressed = filename.endsWith(".json.gz");

    if (isCompressed) {
      // Check if compression is supported
      if (!isCompressionSupported()) {
        throw new Error(
          "Compression Streams API not supported in this browser. Cannot load compressed checkpoint."
        );
      }

      // Convert base64 content back to blob (efficient method for large data)
      const compressedBlob = await new Promise((resolve, reject) => {
        // Create a blob URL from the base64 data
        const byteCharacters = atob(result.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/gzip" });
        resolve(blob);
      });

      // Decompress the data
      const decompressedData = await decompressData(compressedBlob);
      return decompressedData;
    } else {
      // Handle uncompressed JSON data (backward compatibility)
      return result.data;
    }
  } catch (error) {
    console.error("Error loading checkpoint from repo:", error);
    throw error;
  }
}

// Removed: showCheckpointSelection function - no longer needed

// Function to load checkpoint data (extracted from proceedWithLoadCheckpoint)
async function loadCheckpointData(data) {
  // Handle backward compatibility for older checkpoint formats
  if (data.population && data.population.sequences) {
    // Old format had sequences inside population object
    data.sequences = data.population.sequences;
    delete data.population.sequences;
  }

  // Validate checkpoint data
  if (!data.sequences || !data.population || !data.appState) {
    throw new Error("Invalid checkpoint format");
  }

  // Check if sequences array has the correct length
  if (data.sequences.length !== POPULATION_SIZE) {
    throw new Error(
      `Checkpoint has ${data.sequences.length} sequences but current population size is ${POPULATION_SIZE}`
    );
  }

  // Check if population weights/biases have the correct structure
  if (
    data.population.weights.length !== POPULATION_SIZE ||
    data.population.biases.length !== POPULATION_SIZE
  ) {
    throw new Error(
      `Checkpoint population size (${data.population.weights.length}) doesn't match current population size (${POPULATION_SIZE})`
    );
  }

  // Restore sequences
  population.sequences = data.sequences;

  // Restore neural network weights and biases
  population.weights = data.population.weights.map((w) =>
    w.map((arr) => new Float32Array(arr))
  );
  population.biases = data.population.biases.map((b) =>
    b.map((arr) => new Float32Array(arr))
  );

          // Restore app state (evolution count and settings)
        appState.evolutions = data.appState.evolutions || 0;
        appState.startTime = data.appState.startTime || null;
        appState.mutationStrength = data.appState.mutationStrength || 0.1;
                appState.frequencyAdjustment = data.appState.frequencyAdjustment !== undefined ? data.appState.frequencyAdjustment : true;
        appState.learningRate = data.appState.learningRate || 0.02;

  // Reset auto-evolution state when loading checkpoint
  appState.autoSelectRunning = false;
  appState.breedingInProgress = false;
  appState.selectionInProgress = false;

  // Restore evaluation method
  if (data.evaluationMethod) {
    // Uncheck all checkboxes first
    elements.gemmaCheckbox.checked = false;
    elements.englishCheckbox.checked = false;

    // Check the appropriate checkbox
    switch (data.evaluationMethod) {
      case "gemma":
        elements.gemmaCheckbox.checked = true;
        break;
      case "english":
        elements.englishCheckbox.checked = true;
        break;
      case "manual":
        // No checkbox for manual, it's the default
        break;
    }
  }

  // Restore frequency adjustment setting
  if (elements.frequencyAdjustmentCheckbox) {
    elements.frequencyAdjustmentCheckbox.checked = appState.frequencyAdjustment;
  }

  // Restore learning rate setting
  if (elements.learningRateSlider && elements.learningRateValue) {
    elements.learningRateSlider.value = appState.learningRate;
    elements.learningRateValue.textContent = appState.learningRate.toFixed(3);
  }

  // Update mutation strength based on evaluation method
  updateMutationStrength();

  // Update UI and reset auto-evolution button state
  updateUI();

  // Reset auto-evolution button to stopped state
  if (elements.autoButton) {
    elements.autoButton.querySelector(".button-text").textContent =
      "Start Auto-Evolution";
    elements.autoButton.querySelector("i").className = "fas fa-play";
    elements.autoButton.classList.remove("running");
  }
}

function loadCheckpoint() {
  // Check if GitHub checkpoint loading is in progress
  if (appState.checkpointLoadingInProgress) {
    if (confirm("GitHub checkpoint loading is in progress. Loading a local checkpoint will cancel the GitHub loading process. Continue?")) {
      // Cancel GitHub loading
      appState.checkpointLoadingInProgress = false;
      appState.waitingForChoice = false;
      appState.sequenceEvolutionCounts = [];
      
      // Remove checkpoint message if it exists
      const messageContainer = document.getElementById("checkpoint-message");
      if (messageContainer) {
        messageContainer.remove();
      }
      
      // Hide loading and re-enable buttons
      showLoading(false);
    } else {
      return; // User cancelled
    }
  }
  
  proceedWithLoadCheckpoint();
}

function proceedWithLoadCheckpoint() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.gz";
  input.onchange = async (event) => {
    const file = event.target.files[0];
    if (file) {
      // Always show warning when loading checkpoint
      const warningMessage = `Loading checkpoint will replace current progress (${
        appState.evolutions
      } evolutions). Save first if you want to keep it.`;

      if (!confirm(warningMessage)) {
        return; // User cancelled
      }

      try {
        let data;
        const isCompressed = file.name.endsWith(".json.gz");

        if (isCompressed) {
          // Check if compression is supported
          if (!isCompressionSupported()) {
            throw new Error(
              "Compression Streams API not supported in this browser. Cannot load compressed checkpoint."
            );
          }

                  // Read file as blob and decompress
        const compressedBlob = new Blob([file], { type: "application/gzip" });
        data = await decompressData(compressedBlob);
        } else {
          // Read uncompressed JSON file
          const reader = new FileReader();
          const fileContent = await new Promise((resolve, reject) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
          });
          data = JSON.parse(fileContent);
        }

        // Handle backward compatibility for older checkpoint formats
        if (data.population && data.population.sequences) {
          // Old format had sequences inside population object
          data.sequences = data.population.sequences;
          delete data.population.sequences;
        }

        // Validate checkpoint data
        if (!data.sequences || !data.population || !data.appState) {
          throw new Error("Invalid checkpoint format");
        }

        // Check if sequences array has the correct length
        if (data.sequences.length !== POPULATION_SIZE) {
          throw new Error(
            `Checkpoint has ${data.sequences.length} sequences but current population size is ${POPULATION_SIZE}`
          );
        }

        // Check if population weights/biases have the correct structure
        if (
          data.population.weights.length !== POPULATION_SIZE ||
          data.population.biases.length !== POPULATION_SIZE
        ) {
          throw new Error(
            `Checkpoint population size (${data.population.weights.length}) doesn't match current population size (${POPULATION_SIZE})`
          );
        }

        // Restore sequences
        population.sequences = data.sequences;

        // Restore neural network weights and biases
        population.weights = data.population.weights.map((w) =>
          w.map((arr) => new Float32Array(arr))
        );
        population.biases = data.population.biases.map((b) =>
          b.map((arr) => new Float32Array(arr))
        );

        // Restore app state (evolution count and settings)
        appState.evolutions = data.appState.evolutions || 0;
        appState.startTime = data.appState.startTime || null;
        appState.mutationStrength = data.appState.mutationStrength || 0.1;
        appState.frequencyAdjustment = data.appState.frequencyAdjustment !== undefined ? data.appState.frequencyAdjustment : true;
        appState.learningRate = data.appState.learningRate || 0.02;

        // Reset auto-evolution state when loading checkpoint
        appState.autoSelectRunning = false;
        appState.breedingInProgress = false;
        appState.selectionInProgress = false;

        // Restore evaluation method
        if (data.evaluationMethod) {
          // Uncheck all checkboxes first
          elements.gemmaCheckbox.checked = false;
          elements.englishCheckbox.checked = false;

          // Check the appropriate checkbox
          switch (data.evaluationMethod) {
            case "gemma":
              elements.gemmaCheckbox.checked = true;
              break;
            case "english":
              elements.englishCheckbox.checked = true;
              break;
            case "manual":
              // No checkbox for manual, it's the default
              break;
          }
        }

        // Restore frequency adjustment setting
        if (elements.frequencyAdjustmentCheckbox) {
          elements.frequencyAdjustmentCheckbox.checked = appState.frequencyAdjustment;
        }

        // Restore learning rate setting
        if (elements.learningRateSlider && elements.learningRateValue) {
          elements.learningRateSlider.value = appState.learningRate;
          elements.learningRateValue.textContent = appState.learningRate.toFixed(3);
        }

        // Update mutation strength based on evaluation method
        updateMutationStrength();

        // Update UI and reset auto-evolution button state
        updateUI();

        // Reset auto-evolution button to stopped state
        if (elements.autoButton) {
          elements.autoButton.querySelector(".button-text").textContent =
            "Start Auto-Evolution";
          elements.autoButton.querySelector("i").className = "fas fa-play";
          elements.autoButton.classList.remove("running");
        }

        // Show what was restored
        const evalMethodName =
          data.evaluationMethod === "gemma"
            ? "Gemma"
            : data.evaluationMethod === "english"
            ? "English Scorer"
            : "Manual";
        showNotification(
          "success",
          `Checkpoint loaded! ${
            data.appState.evolutions
          } evolutions, method: ${evalMethodName}`
        );
      } catch (error) {
        console.error("Error loading checkpoint:", error);
        showNotification(
          "error",
          "Failed to load checkpoint: " + error.message
        );
      }
    }
  };
  input.click();
}

function resetPopulation() {
  // Check if checkpoint loading is in progress
  if (appState.checkpointLoadingInProgress) {
    if (
      confirm(
        "Checkpoint loading is in progress. Cancel the load and reset to fresh population?"
      )
    ) {
      // Cancel checkpoint loading
      appState.checkpointLoadingInProgress = false;
      appState.waitingForChoice = false;
      appState.sequenceEvolutionCounts = [];

      // Remove checkpoint message if it exists
      const messageContainer = document.getElementById("checkpoint-message");
      if (messageContainer) {
        messageContainer.remove();
      }

      // Reset to fresh population
      initPopulation();
      appState.evolutions = 0;
      appState.bestScore = 0.0;
      appState.startTime = null;

      // Generate new sequences
      try {
        population.sequences = generateSequencesCPU();
        updateUI();
        showNotification(
          "info",
          "Checkpoint loading cancelled. Population reset to fresh sequences!"
        );
        // Show debug print after reset
        debugLetterFrequencies();
      } catch (error) {
        console.error("Error generating sequences after reset:", error);
        showNotification("error", "Failed to generate sequences after reset");
      }
    }
    return;
  }

  // Normal reset when no checkpoint loading is in progress
  if (
    confirm(
      "Are you sure you want to reset the population? This will cause loss of all progress."
    )
  ) {
    // Force complete regeneration by clearing existing population
    population.sequences = [];
    population.weights = [];
    population.biases = [];

    initPopulation();
    appState.evolutions = 0;
    appState.bestScore = 0.0;
    appState.startTime = null;
    // Use CPU version to ensure biases are applied correctly
    population.sequences = generateSequencesCPU();
    updateUI();
    showNotification("info", "Population reset successfully!");
    // Show debug print after reset
    debugLetterFrequencies();
  }
}

async function uploadCheckpointToRepo() {
  try {
    // Show loading state
    const originalText = elements.wowButton.textContent.trim();
    const originalIcon = elements.wowButton.querySelector("i").className;

    // Update button text and icon
    elements.wowButton.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    elements.wowButton.disabled = true;

    // Generate checkpoint data
    const evalMethod = getSelectedEvaluationMethod();
    const timestamp = Date.now();

    // Check if compression is supported and use appropriate filename
    const useCompression = isCompressionSupported();
    const filename = useCompression
      ? `checkpoints/${timestamp}_${appState.evolutions}.json.gz`
      : `checkpoints/${timestamp}_${appState.evolutions}.json`;

    // Add some user-friendly metadata
    const evalMethodName =
      evalMethod === "gemma"
        ? "Gemma3 1B"
        : evalMethod === "english"
        ? "English Scorer"
        : "Manual Selection";

    // Create a clean checkpoint data object to avoid circular references
    const checkpointData = {
      // Current sequences displayed
      sequences: [...population.sequences],

      // Neural network weights and biases (deep copy to avoid references)
      population: {
        weights: population.weights.map((w) => w.map((arr) => Array.from(arr))),
        biases: population.biases.map((b) => b.map((arr) => Array.from(arr))),
      },

      // App state including best score and evolution count
      appState: {
        evolutions: appState.evolutions,
        bestScore: appState.bestScore,
        startTime: appState.startTime,
        mutationStrength: appState.mutationStrength,
        frequencyAdjustment: appState.frequencyAdjustment,
        learningRate: appState.learningRate,
      },

      // Evaluation method
      evaluationMethod: evalMethod,

      // Metadata
      timestamp: timestamp,
      version: "1.0",
      dateCreated: new Date().toISOString(),
      uploadedBy: "FishNet User",
      message: "I think I found something cool! - User checkpoint upload",
      evaluationMethod: evalMethodName,
      userComment: "User found this evolution interesting enough to share!",
    };

    // Prepare content for upload
    let content, message;

    if (useCompression) {
      try {
        // Compress the checkpoint data
        const compressedBlob = await compressData(checkpointData);

        // Convert compressed blob to base64 for upload (efficient method for large data)
        content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            // Remove the "data:application/gzip;base64," prefix
            const base64 = reader.result.split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(compressedBlob);
        });
        message = `Add user checkpoint: ${
          appState.evolutions
        } evolutions (compressed)`;
      } catch (compressionError) {
        console.warn(
          "Compression failed, falling back to uncompressed:",
          compressionError
        );
        // Fallback to uncompressed JSON
        content = JSON.stringify(checkpointData, null, 2);
        message = `Add user checkpoint: ${
          appState.evolutions
        } evolutions (uncompressed)`;
      }
    } else {
      // Use uncompressed JSON
      content = JSON.stringify(checkpointData, null, 2);
      message = `Add user checkpoint: ${
        appState.evolutions
      } evolutions`;
    }

    // Upload to repository via PHP backend
    const response = await fetchWithRetry("./upload_handler.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: filename,
        content: content,
        message: message,
        branch: null,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        // Try to extract JSON from the response if there are PHP warnings
        const jsonMatch = responseText.match(/\{.*\}/s);
        if (jsonMatch) {
          try {
            errorData = JSON.parse(jsonMatch[0]);
          } catch (e2) {
            throw new Error(
              `HTTP error! status: ${response.status}, response: ${responseText}`
            );
          }
        } else {
          throw new Error(
            `HTTP error! status: ${response.status}, response: ${responseText}`
          );
        }
      }
      throw new Error(
        errorData.error || `HTTP error! status: ${response.status}`
      );
    }

    const responseText = await response.text();

    let result;
    try {
      // Try to parse the full response first
      result = JSON.parse(responseText);
    } catch (e) {
      // If that fails, try to extract JSON from the end of the response
      // (PHP warnings might be prepended to the JSON)
      const lastBraceIndex = responseText.lastIndexOf("}");
      if (lastBraceIndex > 0) {
        const jsonPart = responseText.substring(
          responseText.lastIndexOf("{", lastBraceIndex),
          lastBraceIndex + 1
        );
        try {
          result = JSON.parse(jsonPart);
        } catch (e2) {
          throw new Error(`Invalid JSON response: ${responseText}`);
        }
      } else {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
    }

    if (result.success) {
      showNotification(
        "success",
        `Checkpoint uploaded successfully! File: ${filename}`
      );
    } else {
      throw new Error(result.error || "Upload failed");
    }
  } catch (error) {
    console.error("Error uploading checkpoint:", error);
    showNotification("error", `Failed to upload checkpoint: ${error.message}`);
  } finally {
    // Restore button state
    elements.wowButton.innerHTML =
      '<i class="fas fa-star"></i> I think I found something cool!';
    elements.wowButton.disabled = false;
  }
}

// Initialize the app when the page loads
document.addEventListener("DOMContentLoaded", init);

// Track if user has interacted with the page
let userHasInteracted = false;

// Add warning on page close/navigation (only after user interaction)
window.addEventListener("beforeunload", (event) => {
  // Only show warning if user has interacted with the page
  if (userHasInteracted) {
    // Modern browsers require preventDefault() and returnValue to be set
    // Custom messages are ignored for security reasons
    event.preventDefault();
    event.returnValue = "";
  }
});

// Mark user interaction on any click, input, or selection
document.addEventListener(
  "click",
  () => {
    userHasInteracted = true;
  },
  { once: true }
);
document.addEventListener(
  "input",
  () => {
    userHasInteracted = true;
  },
  { once: true }
);
document.addEventListener(
  "keydown",
  () => {
    userHasInteracted = true;
  },
  { once: true }
);

// Helper functions for generating random weights and biases
function generateRandomWeights() {
  const weights = [];

  // Input to first hidden layer
  weights.push(new Float32Array(CPPN_INPUT_SIZE * CPPN_HIDDEN_SIZE));

  // Hidden layers
  for (let j = 0; j < CPPN_NUM_HIDDEN - 1; j++) {
    weights.push(new Float32Array(CPPN_HIDDEN_SIZE * CPPN_HIDDEN_SIZE));
  }

  // Output layer
  weights.push(new Float32Array(CPPN_HIDDEN_SIZE * VOCAB_SIZE));

  // Initialize with random values
  for (let layer = 0; layer < weights.length; layer++) {
    for (let j = 0; j < weights[layer].length; j++) {
      weights[layer][j] = (Math.random() - 0.5) * 0.5;
    }
  }

  return weights;
}

function generateRandomBiases() {
  const biases = [];

  // Input to first hidden layer
  biases.push(new Float32Array(CPPN_HIDDEN_SIZE));

  // Hidden layers
  for (let j = 0; j < CPPN_NUM_HIDDEN - 1; j++) {
    biases.push(new Float32Array(CPPN_HIDDEN_SIZE));
  }

  // Output layer
  biases.push(new Float32Array(VOCAB_SIZE));

  // Initialize with random values
  for (let layer = 0; layer < biases.length; layer++) {
    for (let j = 0; j < biases[layer].length; j++) {
      // Apply frequency adjustment if enabled
      if (appState.frequencyAdjustment && layer === biases.length - 1) {
        // Last layer - apply English letter frequency biases
        if (j === 52) {
          // Space character - bias of 1
          biases[layer][j] = 1.0;
        } else if (j < 26) {
          // Lowercase letters - apply English frequency biases
          const letter = String.fromCharCode(97 + j); // 'a' = 97
          const englishFreq = englishScorer.english_freq[letter] || 0;
          biases[layer][j] = (englishFreq / 100) * 7.0; // Reasonable scale for English frequency biases
        } else if (j < 52) {
          // Uppercase letters - discourage slightly
          biases[layer][j] = -3.0;
        } else if (j >= 53 && j <= 56) {
          // Punctuation - moderate frequency
          biases[layer][j] = -0.1;
        } else {
          biases[layer][j] = 0.0;
        }
      } else {
        // Default behavior - only bias for space
        if (layer === biases.length - 1 && j === 52) {
          // Last layer, space character
          biases[layer][j] = 1.0; // Bias of 0.8 for space
        } else {
          biases[layer][j] = 0.0;
        }
      }
    }
  }

  // Debug: Log the biases for the output layer (removed for cleaner output)

  return biases;
}

// Function to load sequences from user checkpoints
async function loadSequencesFromCheckpoints(checkpoints) {
  try {
    appState.checkpointLoadingInProgress = true;

    // Take up to 9 checkpoints (or less if fewer are available)
    const checkpointsToLoad = checkpoints.slice(0, 9);
    const sequences = [];
    const weights = [];
    const biases = [];
    const evolutionCounts = [];

    if (checkpointsToLoad.length >= POPULATION_SIZE) {
      // If we have 9 or more checkpoints, take one random sequence from each
      for (
        let i = 0;
        i < checkpointsToLoad.slice(0, POPULATION_SIZE).length;
        i++
      ) {
        const checkpoint = checkpointsToLoad.slice(0, POPULATION_SIZE)[i];

        // Add a small delay between requests to prevent overwhelming the server
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
        }

        try {
          // Check if loading was cancelled
          if (!appState.checkpointLoadingInProgress) {
            return;
          }

          const checkpointData = await loadCheckpointFromRepo(checkpoint.name);
          if (checkpointData.sequences && checkpointData.sequences.length > 0) {
            // Pick a random sequence from this checkpoint
            const randomIndex = Math.floor(
              Math.random() * checkpointData.sequences.length
            );
            const selectedSequence = checkpointData.sequences[randomIndex];
            sequences.push(selectedSequence);

            // Load the corresponding weights and biases for the EXACT same individual
            if (
              checkpointData.population &&
              checkpointData.population.weights &&
              checkpointData.population.biases
            ) {
              // Ensure we have weights/biases for this specific individual
              if (
                checkpointData.population.weights.length > randomIndex &&
                checkpointData.population.biases.length > randomIndex
              ) {
                const individualWeights =
                  checkpointData.population.weights[randomIndex];
                const individualBiases =
                  checkpointData.population.biases[randomIndex];

                // Convert to Float32Array and ensure proper structure
                const convertedWeights = individualWeights.map(
                  (w) => new Float32Array(w)
                );
                const convertedBiases = individualBiases.map(
                  (b) => new Float32Array(b)
                );

                weights.push(convertedWeights);
                biases.push(convertedBiases);

                // Store the evolution count from the checkpoint
                const evolutionCount = checkpointData.appState
                  ? checkpointData.appState.evolutions || 0
                  : 0;
                evolutionCounts.push(evolutionCount);


              } else {
                console.warn(
                  `Weights/biases missing for sequence at index ${randomIndex}, generating random ones`
                );
                const randomWeights = generateRandomWeights();
                const randomBiases = generateRandomBiases();
                weights.push(randomWeights);
                biases.push(randomBiases);
                evolutionCounts.push(0); // Default evolution count for random sequences
              }
            } else {
              console.warn(
                `No population data in checkpoint, generating random weights/biases`
              );
              const randomWeights = generateRandomWeights();
              const randomBiases = generateRandomBiases();
              weights.push(randomWeights);
              biases.push(randomBiases);
              evolutionCounts.push(0); // Default evolution count for random sequences
            }
          }
        } catch (error) {
          // Check if loading was cancelled
          if (!appState.checkpointLoadingInProgress) {
            return;
          }

          console.warn(`Failed to load checkpoint ${checkpoint.name}:`, error);
          sequences.push("Checkpoint loading failed");
          const randomWeights = generateRandomWeights();
          const randomBiases = generateRandomBiases();
          weights.push(randomWeights);
          biases.push(randomBiases);
          evolutionCounts.push(0); // Default evolution count for failed checkpoints
        }
      }
    } else {
      // If we have fewer than 9 checkpoints, distribute sequences evenly
      const sequencesPerCheckpoint = Math.floor(
        POPULATION_SIZE / checkpointsToLoad.length
      );
      const remainingSequences = POPULATION_SIZE % checkpointsToLoad.length;

      for (let i = 0; i < checkpointsToLoad.length; i++) {
        const checkpoint = checkpointsToLoad[i];
        const sequencesToTake =
          sequencesPerCheckpoint + (i < remainingSequences ? 1 : 0);

        // Add a small delay between requests to prevent overwhelming the server
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
        }

        try {
          // Check if loading was cancelled
          if (!appState.checkpointLoadingInProgress) {
            return;
          }

          const checkpointData = await loadCheckpointFromRepo(checkpoint.name);
          if (checkpointData.sequences && checkpointData.sequences.length > 0) {
            // Create pairs of sequences and their corresponding weights/biases/evolution counts
            const sequenceWeightPairs = [];

            for (
              let seqIndex = 0;
              seqIndex < checkpointData.sequences.length;
              seqIndex++
            ) {
              const sequence = checkpointData.sequences[seqIndex];
              let individualWeights = null;
              let individualBiases = null;
              let evolutionCount = 0;

              // Get the corresponding weights and biases for this exact sequence
              if (
                checkpointData.population &&
                checkpointData.population.weights &&
                checkpointData.population.biases
              ) {
                if (
                  checkpointData.population.weights.length > seqIndex &&
                  checkpointData.population.biases.length > seqIndex
                ) {
                  individualWeights = checkpointData.population.weights[
                    seqIndex
                  ].map((w) => new Float32Array(w));
                  individualBiases = checkpointData.population.biases[
                    seqIndex
                  ].map((b) => new Float32Array(b));
                }
              }

              // Get the evolution count from the checkpoint
              if (checkpointData.appState) {
                evolutionCount = checkpointData.appState.evolutions || 0;
              }

              sequenceWeightPairs.push({
                sequence: sequence,
                weights: individualWeights,
                biases: individualBiases,
                evolutionCount: evolutionCount,
              });
            }

            // Randomly select the required number of pairs
            for (
              let j = 0;
              j < sequencesToTake && sequenceWeightPairs.length > 0;
              j++
            ) {
              const randomPairIndex = Math.floor(
                Math.random() * sequenceWeightPairs.length
              );
              const selectedPair = sequenceWeightPairs[randomPairIndex];

              sequences.push(selectedPair.sequence);

              if (selectedPair.weights && selectedPair.biases) {
                weights.push(selectedPair.weights);
                biases.push(selectedPair.biases);
                evolutionCounts.push(selectedPair.evolutionCount);

              } else {
                console.warn(
                  `Generating random weights for sequence "${selectedPair.sequence.substring(
                    0,
                    20
                  )}..."`
                );
                const randomWeights = generateRandomWeights();
                const randomBiases = generateRandomBiases();
                weights.push(randomWeights);
                biases.push(randomBiases);
                evolutionCounts.push(0); // Default evolution count for random sequences
              }

              // Remove the selected pair to avoid duplicates
              sequenceWeightPairs.splice(randomPairIndex, 1);
            }
          }
        } catch (error) {
          // Check if loading was cancelled
          if (!appState.checkpointLoadingInProgress) {
            return;
          }

          console.warn(`Failed to load checkpoint ${checkpoint.name}:`, error);
          for (let j = 0; j < sequencesToTake; j++) {
            sequences.push(`Checkpoint loading failed (${j + 1})`);
            const randomWeights = generateRandomWeights();
            const randomBiases = generateRandomBiases();
            weights.push(randomWeights);
            biases.push(randomBiases);
            evolutionCounts.push(0); // Default evolution count for failed checkpoints
          }
        }
      }
    }

    // Fill remaining slots with random sequences if we don't have enough
    while (sequences.length < POPULATION_SIZE) {
      try {
        const randomSequences = generateSequencesCPU();
        sequences.push(randomSequences[0]);
        const randomWeights = generateRandomWeights();
        const randomBiases = generateRandomBiases();
        weights.push(randomWeights);
        biases.push(randomBiases);
        evolutionCounts.push(0); // Default evolution count for random sequences
      } catch (error) {
        sequences.push("Random generation failed");
        const randomWeights = generateRandomWeights();
        const randomBiases = generateRandomBiases();
        weights.push(randomWeights);
        biases.push(randomBiases);
        evolutionCounts.push(0); // Default evolution count for failed random generation
      }
    }

    // Set the sequences and population weights/biases
    population.sequences = sequences.slice(0, POPULATION_SIZE);
    population.weights = weights.slice(0, POPULATION_SIZE);
    population.biases = biases.slice(0, POPULATION_SIZE);

    // Store the evolution counts for each sequence but don't apply them yet
    appState.sequenceEvolutionCounts = evolutionCounts.slice(
      0,
      POPULATION_SIZE
    );
    appState.waitingForChoice = true;


    // Show the checkpoint message
    showCheckpointMessage(checkpointsToLoad.length);
    
    // Grey out the "I think I found something cool!" button since these are just loaded sequences
    if (elements.wowButton) {
      elements.wowButton.disabled = true;
      elements.wowButton.style.opacity = "0.5";
      elements.wowButton.style.cursor = "not-allowed";
      elements.wowButton.title = "Please choose a sequence before uploading to GitHub";
    }
  } catch (error) {
    // Check if loading was cancelled
    if (!appState.checkpointLoadingInProgress) {
      return;
    }

    console.error("Error loading sequences from checkpoints:", error);
    // Fallback to normal initialization
    population.sequences = generateSequencesCPU();
    // Reinitialize weights and biases
    initPopulation();
  } finally {
    appState.checkpointLoadingInProgress = false;
  }
}

// Function to show checkpoint message inside the Text Sequences card
function showCheckpointMessage(checkpointCount) {
  // Find or create the message container
  let messageContainer = document.getElementById("checkpoint-message");
  if (!messageContainer) {
    messageContainer = document.createElement("div");
    messageContainer.id = "checkpoint-message";
    messageContainer.className = "checkpoint-message";

    // Insert at the top of the sequences section, after the h3
    const sequencesSection = document.querySelector(".sequences-section");
    if (sequencesSection) {
      const h3 = sequencesSection.querySelector("h3");
      if (h3) {
        h3.parentNode.insertBefore(messageContainer, h3.nextSibling);
      } else {
        sequencesSection.insertBefore(
          messageContainer,
          sequencesSection.firstChild
        );
      }
    }
  }

  messageContainer.innerHTML = `
    <div class="checkpoint-message-content">
      <p style="color: var(--text-muted); font-size: 0.9em; margin: 0 0 10px 0;">You are choosing sequences from ${checkpointCount} user-evolved checkpoint${
    checkpointCount === 1 ? "" : "s"
  }. 
        <a href="#" id="start-fresh-link">Start from scratch</a> instead.</p>
    </div>
  `;

  // Add event listener for the "Start from scratch" link
  const startFreshLink = messageContainer.querySelector("#start-fresh-link");
  if (startFreshLink) {
    startFreshLink.addEventListener("click", (e) => {
      e.preventDefault();
      startFromScratch();
    });
  }
}

// Debug function to show letter frequencies across all sequences (removed for cleaner output)
function debugLetterFrequencies() {
  // Debug output removed for cleaner console
}

// Function to start from scratch with completely new random everything
function startFromScratch() {
  try {
    // Reset all app state
    appState.evolutions = 0;
    appState.bestScore = 0.0;
    appState.startTime = null;
    appState.waitingForChoice = false;
    appState.sequenceEvolutionCounts = [];
    appState.autoSelectRunning = false;
    appState.breedingInProgress = false;
    appState.selectionInProgress = false;
    appState.fromHumanClick = false;

    // Clear all population data
    population.sequences = [];
    population.weights = [];
    population.biases = [];

    // Generate completely new random weights and biases
    initPopulation();

    // Generate new sequences from the fresh weights/biases
    population.sequences = generateSequencesCPU();

    // Remove the checkpoint message
    const messageContainer = document.getElementById("checkpoint-message");
    if (messageContainer) {
      messageContainer.remove();
    }

    // Update the UI
    updateUI();
    
    // Re-enable the "I think I found something cool!" button
    if (elements.wowButton) {
      elements.wowButton.disabled = false;
      elements.wowButton.style.opacity = "1";
      elements.wowButton.style.cursor = "pointer";
      elements.wowButton.title = "";
    }

    showNotification(
      "info",
      "Started completely fresh with new random weights, biases, and sequences!"
    );

    // Show debug print after reset
    debugLetterFrequencies();
  } catch (error) {
    console.error("Error starting from scratch:", error);
    showNotification("error", "Failed to start from scratch");
  }
}
