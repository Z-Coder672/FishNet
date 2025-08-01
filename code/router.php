<?php
// FishNet SPA Router
// This file handles client-side routing for the Single Page Application

// Get the requested URI
$request_uri = $_SERVER['REQUEST_URI'];
$path = parse_url($request_uri, PHP_URL_PATH);

// Handle static files and API endpoints
$static_extensions = ['css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'woff', 'woff2', 'ttf', 'eot'];
$file_extension = pathinfo($path, PATHINFO_EXTENSION);

// Handle API endpoints (upload_handler.php)
if (strpos($path, 'upload_handler.php') !== false) {
    // Let the upload_handler.php handle the request
    include __DIR__ . '/upload_handler.php';
    exit;
}

if (in_array($file_extension, $static_extensions)) {
    // Serve static file directly
    $file_path = __DIR__ . $path;
    if (file_exists($file_path)) {
        $content_type = '';
        switch ($file_extension) {
            case 'css':
                $content_type = 'text/css';
                break;
            case 'js':
                $content_type = 'application/javascript';
                break;
            case 'png':
                $content_type = 'image/png';
                break;
            case 'jpg':
            case 'jpeg':
                $content_type = 'image/jpeg';
                break;
            case 'gif':
                $content_type = 'image/gif';
                break;
            case 'ico':
                $content_type = 'image/x-icon';
                break;
            case 'svg':
                $content_type = 'image/svg+xml';
                break;
            default:
                $content_type = 'application/octet-stream';
        }
        
        header('Content-Type: ' . $content_type);
        readfile($file_path);
        exit;
    }
}

// Remove leading slash and get the route
$route = trim($path, '/');

// Define valid routes
$valid_routes = ['evolve', 'about'];

// If no route is specified or route is not valid, default to 'evolve'
if (empty($route) || !in_array($route, $valid_routes)) {
    $route = 'evolve';
}

// Set the route for JavaScript to use
$js_route = json_encode($route);

// Read the index.html file
$index_content = file_get_contents(__DIR__ . '/index.html');

// Replace the initial route in the HTML
$index_content = str_replace(
    'window.initialRoute = \'evolve\';',
    'window.initialRoute = ' . $js_route . ';',
    $index_content
);

// Output the modified HTML
echo $index_content;
?> 
