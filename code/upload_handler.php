<?php
/**
 * Web-Only Secure Upload Handler for Shared Hosting
 * Works without shell access - uses file-based rate limiting and validation
 */

// Increase execution time limit for large file operations
set_time_limit(120); // 2 minutes

// Start output buffering immediately
ob_start();

// Set headers first
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    if (!headers_sent()) {
        http_response_code(200);
    }
    if (ob_get_level()) {
        ob_end_flush();
    }
    exit();
}

// Note: File size will be checked after content is received via JSON

// Global rate limiting function using atomic file locking
function recordUploadOrBlock() {
    $rateLimitFile = __DIR__ . '/../private/rate_limit.json';
    
    // Ensure the private directory exists
    $privateDir = dirname($rateLimitFile);
    if (!is_dir($privateDir)) {
        mkdir($privateDir, 0755, true);
    }
    
    // Open file in read/write mode, create if doesn't exist
    $fp = fopen($rateLimitFile, 'c+');
    if (!$fp) {
        header('HTTP/1.1 503 Service Unavailable');
        exit(json_encode(['error' => 'Rate limit service unavailable']));
    }
    
    // Lock the file exclusively
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        header('HTTP/1.1 503 Service Unavailable');
        exit(json_encode(['error' => 'Rate limit service busy']));
    }
    
    // Read existing content
    $content = stream_get_contents($fp);
    $data = json_decode($content, true);
    
    // Initialize if empty or invalid
    if (!$data || !isset($data['uploads'])) {
        $data = ['uploads' => []];
    }
    
    $now = time();
    
    // Filter out timestamps older than 60 seconds
    $data['uploads'] = array_filter($data['uploads'], function($timestamp) use ($now) {
        return ($now - $timestamp) < 60;
    });
    
    // Check if we're at the limit (12 uploads per minute)
    if (count($data['uploads']) >= 12) {
        flock($fp, LOCK_UN);
        fclose($fp);
        header('HTTP/1.1 429 Too Many Requests');
        header('Retry-After: 60');
        exit(json_encode(['error'=>'Rate limit exceeded. Try again later.']));
    }
    
    // Add current timestamp
    $data['uploads'][] = $now;
    
    // Truncate file, rewind, and write back
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data));
    fflush($fp);
    
    // Release lock and close
    flock($fp, LOCK_UN);
    fclose($fp);
}

// Call rate limiting at the very top - before any expensive processing
recordUploadOrBlock();

// Load configuration
if (!file_exists('config.php')) {
    $GITHUB_REPO = 'Z-Coder672/FishNet';
} else {
    require_once 'config.php';
}

// Ensure GITHUB_REPO is always defined
if (!isset($GITHUB_REPO)) {
    $GITHUB_REPO = 'Z-Coder672/FishNet';
}

// Strict server protection limits
ini_set('post_max_size', '16M');           // 15MB content + overhead
ini_set('upload_max_filesize', '16M');     // 15MB content + overhead
ini_set('max_execution_time', 15);         // 15 second timeout
ini_set('memory_limit', '64M');            // 64MB memory limit
ini_set('max_input_time', 15);             // 15 second input timeout

// Error handling
error_reporting(0);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// Set up error handler
function handleError($errno, $errstr, $errfile, $errline) {
    if (!headers_sent()) {
        http_response_code(500);
    }
    
    if (ob_get_level()) {
        ob_clean();
    }
    
    echo json_encode([
        'success' => false,
        'error' => 'PHP Error: ' . $errstr
    ]);
    
    if (ob_get_level()) {
        ob_end_flush();
    }
    exit();
}

set_error_handler('handleError');

// Main request handler
try {
    $method = $_SERVER['REQUEST_METHOD'];
    
    if ($method === 'POST') {
        // Handle file upload
        $input = json_decode(file_get_contents('php://input'), true);
        
        if (!$input) {
            throw new Exception('Invalid JSON input');
        }
        
        $path = $input['path'] ?? '';
        $content = $input['content'] ?? '';
        $message = $input['message'] ?? '';
        $branch = $input['branch'] ?? null;
        
        // Validate inputs
        if (empty($path) || empty($content) || empty($message)) {
            throw new Exception('Missing required fields: path, content, message');
        }
        
        // Security validations
        validatePath($path);
        validateContent($content);
        
        // Process upload directly (no queue on shared hosting)
        $token = getPersonalAccessToken();
        $decodedContent = base64_decode($content);
        
        if ($decodedContent === false) {
            throw new Exception('Invalid base64 content');
        }
        
        $result = uploadFile($GITHUB_REPO, $path, $decodedContent, $message, $token, $branch);
        
        echo json_encode([
            'success' => true,
            'commit_sha' => $result['commit']['sha'],
            'file_sha' => $result['content']['sha'],
            'message' => 'File uploaded successfully'
        ]);
        
    } elseif ($method === 'GET') {
        $action = $_GET['action'] ?? '';
        
        if ($action === 'status') {
            // Return status
            $stats = [
                'server_time' => time(),
                'memory_usage' => memory_get_usage(true)
            ];
            
            echo json_encode([
                'success' => true,
                'stats' => $stats
            ]);
        } elseif ($action === 'file-status') {
            $path = $_GET['path'] ?? '';
            if (empty($path)) {
                throw new Exception('Path parameter required');
            }
            
            $result = getFileStatus($GITHUB_REPO, $path);
            echo json_encode($result);
        } elseif ($action === 'download-file') {
            $path = $_GET['path'] ?? '';
            if (empty($path)) {
                throw new Exception('Path parameter required');
            }
            
            $result = downloadFile($GITHUB_REPO, $path);
            echo json_encode($result);
        } else {
            throw new Exception('Invalid action');
        }
        
    } else {
        throw new Exception('Method not allowed');
    }
    
} catch (Exception $e) {
    if (!headers_sent()) {
        http_response_code(400);
    }
    
    if (ob_get_level()) {
        ob_clean();
    }
    
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}

// Flush and end output buffer
if (ob_get_level()) {
    ob_end_flush();
}

// Helper functions
function validatePath($path) {
    if (!preg_match('/^checkpoints\/\d+_[0-9.]+\.(json|json\.gz)$/', $path)) {
        throw new Exception('Invalid path format');
    }
    
    if (strpos($path, '..') !== false || strpos($path, '//') !== false || strpos($path, '\\') !== false) {
        throw new Exception('Path traversal not allowed');
    }
    
    if (strpos($path, '/') === 0 || strpos($path, 'C:') === 0) {
        throw new Exception('Absolute paths not allowed');
    }
    
    if (strlen($path) > 200) {
        throw new Exception('Path too long');
    }
}

function validateContent($content) {
    $contentSize = strlen($content);
    if ($contentSize > 15 * 1024 * 1024) {  // 15MB limit
        header('HTTP/1.1 413 Payload Too Large');
        exit(json_encode(['error'=>'File exceeds 15 MB limit']));
    }
    
    if ($contentSize < 100) {
        throw new Exception('Content too small: Minimum 100 bytes required');
    }
    
    // PHP code injection prevention
    $phpPatterns = [
        '/<\?php/i',
        '/<\?=/i',
        '/script\s+language\s*=\s*["\']?php["\']?/i',
        '/eval\s*\(/i',
        '/system\s*\(/i',
        '/exec\s*\(/i',
        '/shell_exec\s*\(/i',
        '/passthru\s*\(/i',
        '/`.*`/i',
    ];
    
    // Only check for PHP patterns in text content, not binary data
    if (!preg_match('/^[A-Za-z0-9+\/]*={0,2}$/', $content)) {
        foreach ($phpPatterns as $pattern) {
            if (preg_match($pattern, $content)) {
                throw new Exception('PHP code or shell execution not allowed in content');
            }
        }
    }
    
    // For base64 content, validate it's actually base64
    if (preg_match('/^[A-Za-z0-9+\/]*={0,2}$/', $content)) {
        $decoded = base64_decode($content, true);
        if ($decoded === false) {
            throw new Exception('Invalid base64 content');
        }
        
        // Check for gzip magic bytes (1f 8b 08)
        $isLikelyCompressed = false;
        if (strlen($decoded) >= 3 && 
            ord($decoded[0]) === 0x1f && 
            ord($decoded[1]) === 0x8b && 
            ord($decoded[2]) === 0x08) {
            $isLikelyCompressed = true;
        }
        
        // If it's not compressed data, check for PHP patterns
        if (!$isLikelyCompressed) {
            foreach ($phpPatterns as $pattern) {
                if (preg_match($pattern, $decoded)) {
                    throw new Exception('PHP code or shell execution not allowed in decoded content');
                }
            }
        }
        
        if (strlen($decoded) > 50 * 1024 * 1024) {  // 50MB limit for decompressed
            throw new Exception('Decoded content too large: Maximum 50MB after decompression');
        }
    }
}

function getPersonalAccessToken() {
    $token = getenv('GITHUB_PERSONAL_TOKEN');
    if (!$token) {
        $token = $_ENV['GITHUB_PERSONAL_TOKEN'] ?? null;
    }
    if (!$token) {
        throw new Exception('GITHUB_PERSONAL_TOKEN environment variable not set');
    }
    return $token;
}

function uploadFile($repo, $path, $content, $message, $token, $branch = null) {
    $data = [
        'message' => $message,
        'content' => base64_encode($content)
    ];
    
    if ($branch) {
        $data['branch'] = $branch;
    }
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://api.github.com/repos/' . $repo . '/contents/' . $path);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60); // 60 second timeout for uploads
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10); // 10 second connection timeout
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: token ' . $token,
        'Accept: application/vnd.github.v3+json',
        'User-Agent: FishNet-Uploader',
        'Content-Type: application/json'
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 201) {
        $errorData = json_decode($response, true);
        throw new Exception('Upload failed: ' . ($errorData['message'] ?? 'Unknown error'));
    }
    
    return json_decode($response, true);
}

function extractScoreFromPath($path) {
    if (preg_match('/_([0-9.]+)\.(json|json\.gz)$/', $path, $matches)) {
        return $matches[1];
    }
    return '0.0000';
}

function getFileStatus($repo, $path) {
    $token = getPersonalAccessToken();
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://api.github.com/repos/' . $repo . '/contents/' . $path);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30); // 30 second timeout
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10); // 10 second connection timeout
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: token ' . $token,
        'Accept: application/vnd.github.v3+json',
        'User-Agent: FishNet-Uploader'
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 404) {
        return [
            'success' => true,
            'exists' => false
        ];
    }
    
    if ($httpCode !== 200) {
        return [
            'success' => false,
            'error' => 'Failed to get file status: HTTP ' . $httpCode . ' - Response: ' . $response
        ];
    }
    
    $data = json_decode($response, true);
    
    // Check if it's an array (directory contents) or object (single file)
    if (is_array($data)) {
        // It's a directory listing (array of files)
        $files = [];
        foreach ($data as $item) {
            if (is_array($item) && isset($item['name']) && isset($item['type'])) {
                if ($item['type'] === 'file' && (strpos($item['name'], '.json') !== false)) {
                    $files[] = [
                        'name' => $item['name'],
                        'size' => $item['size'] ?? 0,
                        'sha' => $item['sha'] ?? '',
                        'type' => 'file'
                    ];
                }
            }
        }
        
        return [
            'success' => true,
            'exists' => true,
            'type' => 'directory',
            'files' => $files
        ];
    } else {
        // It's a single file object
        return [
            'success' => true,
            'exists' => true,
            'type' => 'file',
            'size' => $data['size'] ?? 0,
            'sha' => $data['sha'] ?? ''
        ];
    }
}

function downloadFile($repo, $path) {
    $token = getPersonalAccessToken();
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://api.github.com/repos/' . $repo . '/contents/' . $path);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30); // 30 second timeout
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10); // 10 second connection timeout
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: token ' . $token,
        'Accept: application/vnd.github.v3+json',
        'User-Agent: FishNet-Uploader'
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        return [
            'success' => false,
            'error' => 'Failed to download file: HTTP ' . $httpCode . ' - Response: ' . $response
        ];
    }
    
    $data = json_decode($response, true);
    
    if (!isset($data['content']) || !isset($data['encoding'])) {
        return [
            'success' => false,
            'error' => 'Invalid file data received'
        ];
    }
    
    // Handle large files that GitHub returns with encoding: "none"
    if ($data['encoding'] === 'none') {
        // For large files, we need to download the raw content using the download_url
        if (!isset($data['download_url'])) {
            return [
                'success' => false,
                'error' => 'Large file detected but no download URL available'
            ];
        }
        
        // Download the raw file content
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $data['download_url']);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60); // 60 second timeout for large files
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10); // 10 second connection timeout
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'User-Agent: FishNet-Uploader'
        ]);
        
        $rawContent = curl_exec($ch);
        $downloadHttpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($downloadHttpCode !== 200) {
            return [
                'success' => false,
                'error' => 'Failed to download raw file: HTTP ' . $downloadHttpCode
            ];
        }
        
        return [
            'success' => true,
            'data' => base64_encode($rawContent), // Return as base64 for consistency
            'size' => strlen($rawContent),
            'sha' => $data['sha'] ?? ''
        ];
    }
    
    if ($data['encoding'] !== 'base64') {
        return [
            'success' => false,
            'error' => 'Unsupported encoding: ' . $data['encoding']
        ];
    }
    
    $content = base64_decode($data['content']);
    if ($content === false) {
        return [
            'success' => false,
            'error' => 'Failed to decode base64 content'
        ];
    }
    
    return [
        'success' => true,
        'data' => $data['content'], // Return the base64 content as 'data' to match JavaScript expectations
        'size' => strlen($content),
        'sha' => $data['sha'] ?? ''
    ];
}
?> 
