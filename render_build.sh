#!/bin/bash
echo "=== Starting Build Process ==="
echo "Current directory: $(pwd)"
echo "Files: $(ls -la)"

echo "Installing dependencies..."
pip install -r requirements.txt

echo "Checking WebApp directory..."
if [ -d "webapp" ]; then
    echo "WebApp directory exists: $(ls -la webapp/)"
else
    echo "ERROR: WebApp directory not found!"
    exit 1
fi

echo "Build completed!"