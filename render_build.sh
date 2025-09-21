#!/bin/bash
echo "Starting build process..."
echo "Updating pip..."
python -m pip install --upgrade pip

echo "Installing dependencies..."
pip install -r requirements.txt

echo "Initializing database..."
python init_db.py

echo "Build completed successfully!"