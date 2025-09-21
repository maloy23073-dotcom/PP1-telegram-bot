#!/bin/bash
echo "=== Starting Build Process ==="

echo "1. Updating pip..."
python -m pip install --upgrade pip

echo "2. Installing dependencies..."
pip install -r requirements.txt

echo "3. Build completed successfully!"
echo "=== Ready to start server ==="