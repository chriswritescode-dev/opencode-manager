#!/usr/bin/env python3
"""
Faster Whisper STT Server
Runs as a subprocess managed by the OpenCode Manager backend.
Provides HTTP API for speech-to-text transcription.
"""

import os
import sys
import json
import tempfile
import logging
from pathlib import Path
from typing import Optional

try:
    from fastapi import FastAPI, UploadFile, File, HTTPException, Form
    from fastapi.responses import JSONResponse
    import uvicorn
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "python-multipart"])
    from fastapi import FastAPI, UploadFile, File, HTTPException, Form
    from fastapi.responses import JSONResponse
    import uvicorn

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Installing faster-whisper...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "faster-whisper"])
    from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Faster Whisper STT Server", version="1.0.0")

MODELS_DIR = os.environ.get("WHISPER_MODELS_DIR", str(Path.home() / ".cache" / "whisper"))
DEFAULT_MODEL = os.environ.get("WHISPER_DEFAULT_MODEL", "base")
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "auto")

AVAILABLE_MODELS = ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large-v2", "large-v3"]

model_cache: dict[str, WhisperModel] = {}
current_model_name: Optional[str] = None


def get_model(model_name: str = DEFAULT_MODEL) -> WhisperModel:
    global current_model_name
    
    if model_name not in AVAILABLE_MODELS:
        model_name = DEFAULT_MODEL
    
    if model_name in model_cache:
        return model_cache[model_name]
    
    logger.info(f"Loading Whisper model: {model_name}")
    
    device = DEVICE
    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"
    
    compute_type = COMPUTE_TYPE
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"
    
    model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        download_root=MODELS_DIR
    )
    
    model_cache[model_name] = model
    current_model_name = model_name
    logger.info(f"Model {model_name} loaded successfully on {device} with {compute_type}")
    
    return model


@app.on_event("startup")
async def startup_event():
    logger.info("Starting Faster Whisper STT Server...")
    logger.info(f"Models directory: {MODELS_DIR}")
    logger.info(f"Default model: {DEFAULT_MODEL}")
    try:
        get_model(DEFAULT_MODEL)
        logger.info("Default model pre-loaded successfully")
    except Exception as e:
        logger.warning(f"Could not pre-load model: {e}. Will load on first request.")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": current_model_name is not None,
        "current_model": current_model_name,
        "available_models": AVAILABLE_MODELS
    }


@app.get("/models")
async def list_models():
    return {
        "models": AVAILABLE_MODELS,
        "current": current_model_name,
        "default": DEFAULT_MODEL
    }


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    model: str = Form(default=DEFAULT_MODEL),
    language: Optional[str] = Form(default=None),
    task: str = Form(default="transcribe")
):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided")
    
    suffix = Path(audio.filename).suffix or ".webm"
    tmp_path = None
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            content = await audio.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        whisper_model = get_model(model)
        
        segments, info = whisper_model.transcribe(
            tmp_path,
            language=language,
            task=task,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=400
            )
        )
        
        segments_list = list(segments)
        
        full_text = " ".join(segment.text.strip() for segment in segments_list)
        
        result = {
            "text": full_text,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "segments": [
                {
                    "start": seg.start,
                    "end": seg.end,
                    "text": seg.text.strip(),
                    "confidence": seg.avg_logprob
                }
                for seg in segments_list
            ]
        }
        
        return JSONResponse(content=result)
        
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except:
                pass


@app.post("/transcribe-base64")
async def transcribe_base64(request: dict):
    import base64
    
    audio_data = request.get("audio")
    model_name = request.get("model", DEFAULT_MODEL)
    language = request.get("language")
    file_format = request.get("format", "webm")
    
    if not audio_data:
        raise HTTPException(status_code=400, detail="No audio data provided")
    
    tmp_path = None
    
    try:
        if "," in audio_data:
            audio_data = audio_data.split(",")[1]
        
        audio_bytes = base64.b64decode(audio_data)
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_format}") as tmp_file:
            tmp_file.write(audio_bytes)
            tmp_path = tmp_file.name
        
        whisper_model = get_model(model_name)
        
        segments, info = whisper_model.transcribe(
            tmp_path,
            language=language,
            task="transcribe",
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=400
            )
        )
        
        segments_list = list(segments)
        full_text = " ".join(segment.text.strip() for segment in segments_list)
        
        return JSONResponse(content={
            "text": full_text,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration
        })
        
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except:
                pass


if __name__ == "__main__":
    port = int(os.environ.get("WHISPER_PORT", "5552"))
    host = os.environ.get("WHISPER_HOST", "127.0.0.1")
    
    logger.info(f"Starting Whisper server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
