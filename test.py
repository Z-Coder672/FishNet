<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About - FishNet</title>
    <link rel="icon" type="image/png" href="darkicon.png" id="favicon">
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .about-content {
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .about-section {
            margin-bottom: 3rem;
        }
        
        .about-section h2 {
            color: var(--primary-color);
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 0.5rem;
            margin-bottom: 1.5rem;
        }
        
        .about-section h3 {
            color: var(--text-color);
            margin-top: 2rem;
            margin-bottom: 1rem;
        }
        
        .about-section p {
            line-height: 1.6;
            margin-bottom: 1rem;
        }
        
        .code-block {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
            font-family: 'Courier New', monospace;
            overflow-x: auto;
        }
        
        .feature-list {
            list-style: none;
            padding: 0;
        }
        
        .feature-list li {
            padding: 0.5rem 0;
            border-bottom: 1px solid var(--border-color);
        }
        
        .feature-list li:before {
            content: "✓";
            color: var(--success-color);
            font-weight: bold;
            margin-right: 0.5rem;
        }
        
        .warning-box {
            background: rgba(255, 183, 77, 0.1);
            border: 1px solid var(--warning-color);
            border-radius: 8px;
            padding: 1rem;
            margin: 1rem 0;
        }
        
        .warning-box h4 {
            color: var(--warning-color);
            margin-top: 0;
        }
        
        .setup-steps {
            counter-reset: step-counter;
        }
        
        .setup-steps li {
            counter-increment: step-counter;
            margin-bottom: 1rem;
            padding-left: 2rem;
            position: relative;
        }
        
        .setup-steps li::before {
            content: counter(step-counter);
            position: absolute;
            left: 0;
            top: 0;
            background: var(--primary-color);
            color: white;
            width: 1.5rem;
            height: 1.5rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="nav-content">
            <a href="/" class="nav-brand">
                <img src="darkicon.png" alt="FishNet" class="nav-logo dark-logo" id="nav-logo-dark">
                <img src="lighticon.png" alt="FishNet" class="nav-logo light-logo" id="nav-logo-light">
                FishNet
            </a>
            <div class="nav-links">
                <div class="nav-links-group">
                    <a href="/">Evolve</a>
                    <a href="about.html" class="active">About</a>
                </div>
                <button id="themeToggle" class="theme-toggle" aria-label="Toggle theme">
                    <svg class="sun-icon" viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41.39.39 1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41.39.39 1.03.39 1.41 0l1.06-1.06z"/>
                    </svg>
                    <svg class="moon-icon" viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
                    </svg>
                </button>
            </div>
        </div>
    </nav>

    <div class="content-container">
        <main class="container">
            <section class="hero">
                <h1>About FishNet</h1>
                <p class="subtitle">Interactive text evolution using neural networks</p>
            </section>

            <div class="about-content">
                <div class="about-section">
                    <h2>What is FishNet?</h2>
                    <p>
                        FishNet is an interactive application that uses Compositional Pattern-Producing Networks (CPPNs) 
                        to generate and evolve text sequences. The system employs a population-based evolutionary algorithm 
                        where neural networks compete and reproduce based on various evaluation criteria.
                    </p>
                    
                    <h3>Key Features</h3>
                    <ul class="feature-list">
                        <li><strong>CPU-Based Generation:</strong> Reliable neural network computation with deterministic results</li>
                        <li><strong>Multiple Evaluation Methods:</strong> Choose between AI-powered evaluation (Gemma3 1B) or statistical language scoring</li>
                        <li><strong>Interactive Breeding:</strong> Click on sequences to manually select parents for breeding</li>
                        <li><strong>Auto-Evolution:</strong> Let the system automatically evolve text using selected criteria</li>
                        <li><strong>Checkpoint System:</strong> Save and load population states</li>
                        <li><strong>Real-time Statistics:</strong> Monitor evolution progress and performance</li>
                        <li><strong>Dynamic Mutation Rates:</strong> Different mutation strengths for different evaluation methods</li>
                    </ul>
                </div>

                <div class="about-section">
                    <h2>How It Works</h2>
                    <h3>Neural Network Architecture</h3>
                    <p>
                        Each individual in the population is a CPPN (Compositional Pattern-Producing Network) with:
                    </p>
                    <ul>
                        <li><strong>Input Layer:</strong> 32-dimensional position encoding</li>
                        <li><strong>Hidden Layers:</strong> 6 layers with 128 neurons each</li>
                        <li><strong>Output Layer:</strong> 64-dimensional vocabulary distribution</li>
                        <li><strong>Activation:</strong> Tanh activation functions</li>
                    </ul>

                    <h3>Evolution Process</h3>
                    <p>
                        The evolution follows a PicBreeder-inspired algorithm:
                    </p>
                    <ol>
                        <li>Generate 8 text sequences using the current population</li>
                        <li>Evaluate sequences using the selected method (Gemma3 1B, English scoring, or manual selection)</li>
                        <li>Select the best sequence as the parent</li>
                        <li>Delete all other networks and create 8 new networks by copying and mutating the parent</li>
                        <li>Apply tested mutation rates based on evaluation method (Human: 0.02, Gemma: 0.03, Score-based: 0.1)</li>
                        <li>Repeat the process</li>
                    </ol>
                </div>

                <div class="about-section">
                    <h2>Evaluation Methods</h2>
                    
                    <h3>Gemma3 1B (Ollama API)</h3>
                    <p>
                        Uses the Gemma3 1B language model to evaluate text "interestingness". This method sends the 
                        generated sequences to a local Ollama instance and asks the AI to choose the most interesting one.
                    </p>
                    
                    <h3>English Scorer</h3>
                    <p>
                        Statistical evaluation based on English language characteristics with automatic revert logic:
                    </p>
                    <ul>
                        <li><strong>Letter Frequency:</strong> How well the text matches English letter distributions</li>
                        <li><strong>Bigram Analysis:</strong> Common two-letter combinations in English</li>
                        <li><strong>Vocabulary Score:</strong> Presence of common English words</li>
                        <li><strong>Structural Score:</strong> Sentence structure and punctuation patterns</li>
                        <li><strong>Revert Logic:</strong> If all mutations are worse than the parent, automatically revert and create new mutations</li>
                    </ul>
                </div>

                <div class="about-section">
                    <h2>Setting Up Ollama</h2>
                    
                    <div class="warning-box">
                        <h4>⚠️ Important</h4>
                        <p>
                            The Gemma3 1B evaluation method requires a local Ollama instance running on your machine. 
                            Without Ollama, the system will fall back to English scoring.
                        </p>
                    </div>

                    <h3>Installation Steps</h3>
                    <ol class="setup-steps" style="list-style-type: none;">
                        <li>
                            <strong>Install Ollama:</strong>
                            Visit <a href="https://ollama.com/download" target="_blank">ollama.com/download</a> to download the appropriate version for your system.
                        </li>
                        
                        <li>
                            <strong>Start Ollama service:</strong>
                            <br>
                            <br>Run:
                            <div class="code-block">
                                ollama serve
                            </div>
                        </li>
                        
                        <li>
                            <strong>Pull the Gemma3 1B model:</strong>
                            <br>
                            <br>Run:
                            <div class="code-block">
                                ollama pull gemma3:1b
                            </div>
                        </li>
                        
                        <li>
                            <strong>Test the installation:</strong>
                            <br>
                            <br>Run:
                            <div class="code-block">
                                ollama run gemma3:1b "Hello, world!"
                            </div>
                        </li>
                    </ol>

                    <h3>Running the Application</h3>
                    <ol class="setup-steps" style="list-style-type: none;">
                        
                        <li>
                            <strong>Open your browser:</strong>
                            <br>
                            <br>Visit:
                            <br>
                            <div class="code-block">
                                <a href="https://fishnet.zimmzimm.com" target="_blank">https://fishnet.zimmzimm.com</a>
                            </div>
                        </li>
                        
                        <li>
                            <strong>Choose your evaluation method:</strong>
                            <ul class="setup-steps" style="list-style-type: none; margin-top: 1.7rem;">
                                <li><strong>Gemma3 1B (Ollama API):</strong> For AI-powered evolution (requires Ollama setup)</li>
                                <li><strong>English Scorer:</strong> For statistical language quality evaluation</li>
                                <li><strong>Manual Selection:</strong> For interactive human-guided evolution</li>
                            </ul>
                        </li>
                    </ol>

                    <h3>Troubleshooting</h3>
                    <ul>
                        <li><strong>Ollama Connection Failed:</strong> Ensure Ollama is running with <code>ollama serve</code></li>
                        <li><strong>Model Not Found:</strong> Pull the model with <code>ollama pull gemma3:1b</code></li>
                        <li><strong>Slow Responses:</strong> Ensure you have enough RAM to run the model (about 4GB absolute minimum for running Gemma3 1B plus FishNet, 8GB or more recommended). The first few API calls may be slow as the model loads into memory</li>
                    </ul>
                </div>

                <div class="about-section">
                    <h2>Technical Details</h2>
                    
                    <h3>CPU-Based Implementation</h3>
                    <p>
                        The application uses CPU-based neural network computation for reliable and deterministic 
                        text generation and evolution. This ensures consistent results and eliminates GPU compatibility 
                        issues while maintaining good performance for the evolutionary algorithm.
                    </p>
                    
                    <h3>Network Copying and Mutation</h3>
                    <p>
                        The system implements robust deep copying of neural networks to ensure that when a parent 
                        is selected, all offspring are exact copies before mutation is applied. This guarantees 
                        that the evolution process works correctly and that identical networks produce identical 
                        sequences.
                    </p>
                    
                    <h3>Mutation Rate Strategy</h3>
                    <p>
                        Different mutation rates are used based on the evaluation method:
                    </p>
                    <ul>
                        <li><strong>Human Selection (0.02):</strong> Gentle mutations for fine manual control</li>
                        <li><strong>Gemma3 1B Evaluation (0.03):</strong> Moderate mutations for AI-guided evolution</li>
                        <li><strong>Score-based Evaluation (0.1):</strong> Aggressive mutations for automated optimization</li>
                    </ul>
                </div>

                <div class="about-section">
                    <h2>Project Structure</h2>
                    <ul>
                        <li><strong>index.html:</strong> Main application interface with Font Awesome icons</li>
                        <li><strong>about.html:</strong> This documentation page</li>
                        <li><strong>langbreeder.js:</strong> Core FishNet application logic with CPU-based neural network implementation</li>
                        <li><strong>styles.css:</strong> Application styling with dark/light theme support</li>
                        <li><strong>server.py:</strong> Simple HTTP server for local development</li>
                        <li><strong>LangBreeder.py:</strong> Python reference implementation (FishNet)</li>
                    </ul>
                </div>
            </div>
        </main>
    </div>

    <script>
        // Theme management and navigation highlighting
        document.addEventListener('DOMContentLoaded', function() {
            // Set initial theme
            const currentTheme = localStorage.getItem('theme') || 'dark';
            document.documentElement.setAttribute('data-theme', currentTheme);
            
            // Set initial favicon
            const favicon = document.getElementById('favicon');
            favicon.href = currentTheme === 'dark' ? 'darkicon.png' : 'lighticon.png';
            
            // Set initial nav logo
            const navLogoDark = document.getElementById('nav-logo-dark');
            const navLogoLight = document.getElementById('nav-logo-light');
            if (navLogoDark && navLogoLight) {
                if (currentTheme === 'dark') {
                    navLogoDark.style.display = 'block';
                    navLogoLight.style.display = 'none';
                } else {
                    navLogoDark.style.display = 'none';
                    navLogoLight.style.display = 'block';
                }
            }
            
            // Theme toggle functionality
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.addEventListener('click', () => {
                    const currentTheme = document.documentElement.getAttribute('data-theme');
                    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
                    
                    document.documentElement.setAttribute('data-theme', newTheme);
                    localStorage.setItem('theme', newTheme);
                    
                    // Update favicon
                    const favicon = document.getElementById('favicon');
                    favicon.href = newTheme === 'dark' ? 'darkicon.png' : 'lighticon.png';
                    
                    // Update nav logo
                    const navLogoDark = document.getElementById('nav-logo-dark');
                    const navLogoLight = document.getElementById('nav-logo-light');
                    if (navLogoDark && navLogoLight) {
                        if (newTheme === 'dark') {
                            navLogoDark.style.display = 'block';
                            navLogoLight.style.display = 'none';
                        } else {
                            navLogoDark.style.display = 'none';
                            navLogoLight.style.display = 'block';
                        }
                    }
                });
            }
            
            // Navigation highlighting
            const currentPage = window.location.pathname.split('/').pop();
            const navLinks = document.querySelectorAll('.nav-links a');
            
            navLinks.forEach(link => {
                if (link.getAttribute('href') === currentPage) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        });
    </script>
</body>
</html> 