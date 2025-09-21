#!/bin/bash
echo "=== Starting Clean Build ==="

# Останавливаемся при любой ошибке
set -e

echo "1. Removing existing virtual environment..."
rm -rf .venv/

echo "2. Creating new virtual environment..."
python -m venv .venv
source .venv/bin/activate

echo "3. Upgrading pip and setuptools..."
pip install --upgrade pip setuptools

echo "4. Installing dependencies..."
pip install fastapi==0.104.1 uvicorn[standard]==0.24.0 python-telegram-bot==20.8 apscheduler==3.10.4 aiohttp==3.9.3 python-dotenv==1.0.0

echo "5. Verifying installation..."
pip list | grep telegram

echo "✅ Build completed successfully!"