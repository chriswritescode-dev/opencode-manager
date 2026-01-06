#!/bin/bash
set -e

VENV_DIR="${1:-$HOME/.opencode-manager/chatterbox-venv}"

for py in python3.11 python3.12 python3.10; do
    if command -v "$py" &> /dev/null; then
        PYTHON_BIN="$py"
        break
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo "ERROR: Python 3.10-3.12 is required for chatterbox-tts"
    echo "Python 3.13+ is not compatible with chatterbox-tts dependencies"
    echo ""
    echo "Install Python 3.11 with: brew install python@3.11"
    exit 1
fi

echo "Setting up Chatterbox TTS virtual environment..."
echo "Target directory: $VENV_DIR"
echo "Using Python: $PYTHON_BIN ($($PYTHON_BIN --version))"

if [ -d "$VENV_DIR" ] && [ -f "$VENV_DIR/bin/python" ]; then
    echo "Virtual environment already exists at $VENV_DIR"
    echo "To recreate, delete the directory and run this script again"
    
    if "$VENV_DIR/bin/python" -c "import chatterbox" 2>/dev/null; then
        echo "Chatterbox is already installed"
        exit 0
    else
        echo "Chatterbox not found, installing..."
    fi
else
    echo "Creating virtual environment..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

echo "Upgrading pip..."
pip install --upgrade pip

echo "Installing PyTorch (this may take a while)..."
if [[ "$(uname)" == "Darwin" ]] && [[ "$(uname -m)" == "arm64" ]]; then
    pip install torch==2.6.0 torchaudio==2.6.0
else
    pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
fi

echo "Installing chatterbox-tts and dependencies..."
pip install 'numpy>=1.24.0,<1.26.0'
pip install 'safetensors==0.5.3'
pip install 'transformers==4.46.3'
pip install chatterbox-tts==0.1.6

echo "Installing server dependencies..."
pip install fastapi uvicorn python-multipart

echo "Verifying installation..."
python -c "from chatterbox.tts import ChatterboxTTS; print('Chatterbox TTS installed successfully!')"

echo ""
echo "Setup complete!"
echo "Virtual environment: $VENV_DIR"
echo ""
echo "To use this venv with opencode-manager, set:"
echo "  export CHATTERBOX_VENV=$VENV_DIR"
