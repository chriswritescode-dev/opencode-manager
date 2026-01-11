#!/usr/bin/env python3
"""
Coqui TTS Server with Jenny Model
Runs as a subprocess managed by the OpenCode Manager backend.
Provides HTTP API for text-to-speech synthesis using Coqui TTS with Jenny voice.
"""

import os
import sys
import io
import logging
from pathlib import Path
from typing import Optional

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import StreamingResponse
    import uvicorn
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn"])
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import StreamingResponse
    import uvicorn

try:
    import torch
except ImportError:
    print("Installing torch...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "torch"])
    import torch

try:
    from TTS.api import TTS
except ImportError:
    print("Installing TTS...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "TTS"])
    from TTS.api import TTS

import scipy.io.wavfile as wavfile
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Coqui TTS Server", version="1.0.0")

COQUI_PORT = int(os.environ.get("COQUI_PORT", "5554"))
COQUI_HOST = os.environ.get("COQUI_HOST", "127.0.0.1")
COQUI_DEVICE = os.environ.get("COQUI_DEVICE", "auto")
COQUI_MODEL = os.environ.get("COQUI_MODEL", "tts_models/en/jenny/jenny")

model: Optional[TTS] = None
device: str = "cpu"
sample_rate: int = 22050


def get_device() -> str:
    global device
    if COQUI_DEVICE == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "cpu"  # MPS has issues with some TTS models, use CPU
        else:
            device = "cpu"
    else:
        device = COQUI_DEVICE
    return device


def get_model() -> TTS:
    global model, sample_rate
    if model is None:
        dev = get_device()
        logger.info(f"Loading Coqui TTS model '{COQUI_MODEL}' on {dev}...")
        model = TTS(model_name=COQUI_MODEL, progress_bar=True)
        if dev == "cuda":
            model = model.to(dev)
        
        if hasattr(model, 'synthesizer') and hasattr(model.synthesizer, 'output_sample_rate'):
            sample_rate = model.synthesizer.output_sample_rate
        else:
            sample_rate = 22050
            
        logger.info(f"Coqui TTS model loaded successfully (sample_rate={sample_rate})")
    return model


@app.on_event("startup")
async def startup_event():
    logger.info("Starting Coqui TTS Server...")
    logger.info(f"Model: {COQUI_MODEL}")
    logger.info(f"Device preference: {COQUI_DEVICE}")
    try:
        get_model()
        logger.info("Coqui TTS model pre-loaded successfully")
    except Exception as e:
        logger.warning(f"Could not pre-load model: {e}. Will load on first request.")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "model_name": COQUI_MODEL,
        "device": device,
        "sample_rate": sample_rate,
        "cuda_available": torch.cuda.is_available(),
        "mps_available": hasattr(torch.backends, "mps") and torch.backends.mps.is_available(),
    }


@app.get("/models")
async def list_models():
    return {
        "models": [
            {
                "id": "tts_models/en/jenny/jenny",
                "name": "Jenny",
                "description": "High-quality English female voice (recommended)",
                "language": "en"
            },
            {
                "id": "tts_models/en/ljspeech/tacotron2-DDC",
                "name": "LJSpeech Tacotron2",
                "description": "Classic English female voice",
                "language": "en"
            },
            {
                "id": "tts_models/en/vctk/vits",
                "name": "VCTK VITS",
                "description": "Multi-speaker English model",
                "language": "en"
            }
        ],
        "current_model": COQUI_MODEL
    }


@app.get("/voices")
async def list_voices():
    tts_model = get_model()
    
    voices = []
    if tts_model.is_multi_speaker and hasattr(tts_model, 'speakers') and tts_model.speakers:
        for speaker in tts_model.speakers:
            voices.append({
                "id": speaker,
                "name": speaker.replace("_", " ").title(),
                "description": f"Speaker: {speaker}"
            })
    else:
        voices.append({
            "id": "default",
            "name": "Jenny",
            "description": "Default Jenny voice"
        })
    
    return {
        "voices": [v["id"] for v in voices],
        "voice_details": voices,
        "is_multi_speaker": tts_model.is_multi_speaker if hasattr(tts_model, 'is_multi_speaker') else False
    }


@app.post("/synthesize")
async def synthesize(request: dict):
    text = request.get("input") or request.get("text")
    voice_id = request.get("voice", "default")
    speed = request.get("speed", 1.0)
    
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    
    if len(text) > 4096:
        raise HTTPException(status_code=400, detail="Text too long (max 4096 characters)")
    
    try:
        tts_model = get_model()
        
        logger.info(f"Synthesizing text with voice '{voice_id}', speed={speed}")
        
        kwargs = {}
        if tts_model.is_multi_speaker and voice_id != "default":
            kwargs["speaker"] = voice_id
        if hasattr(tts_model, 'is_multi_lingual') and tts_model.is_multi_lingual:
            kwargs["language"] = "en"
        
        wav = tts_model.tts(text=text, **kwargs)
        
        wav_np = np.array(wav, dtype=np.float32)
        
        if wav_np.max() > 1.0 or wav_np.min() < -1.0:
            wav_np = wav_np / max(abs(wav_np.max()), abs(wav_np.min()))
        
        wav_int16 = (wav_np * 32767).astype(np.int16)
        
        buffer = io.BytesIO()
        wavfile.write(buffer, sample_rate, wav_int16)
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=speech.wav"
            }
        )
        
    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/audio/speech")
async def openai_compatible_synthesize(request: dict):
    text = request.get("input")
    voice = request.get("voice", "default")
    speed = request.get("speed", 1.0)
    response_format = request.get("response_format", "wav")
    
    if not text:
        raise HTTPException(status_code=400, detail="No input text provided")
    
    if len(text) > 4096:
        raise HTTPException(status_code=400, detail="Text too long (max 4096 characters)")
    
    try:
        tts_model = get_model()
        
        logger.info(f"OpenAI-compatible synthesis: voice='{voice}', format='{response_format}'")
        
        kwargs = {}
        if tts_model.is_multi_speaker and voice != "default":
            kwargs["speaker"] = voice
        if hasattr(tts_model, 'is_multi_lingual') and tts_model.is_multi_lingual:
            kwargs["language"] = "en"
        
        wav = tts_model.tts(text=text, **kwargs)
        
        wav_np = np.array(wav, dtype=np.float32)
        if wav_np.max() > 1.0 or wav_np.min() < -1.0:
            wav_np = wav_np / max(abs(wav_np.max()), abs(wav_np.min()))
        wav_int16 = (wav_np * 32767).astype(np.int16)
        
        buffer = io.BytesIO()
        wavfile.write(buffer, sample_rate, wav_int16)
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type="audio/wav"
        )
        
    except Exception as e:
        logger.error(f"OpenAI-compatible synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/audio/voices")
async def openai_compatible_list_voices():
    voices_data = await list_voices()
    return {
        "data": [
            {
                "id": v["id"],
                "name": v["name"],
                "description": v.get("description", ""),
            }
            for v in voices_data["voice_details"]
        ]
    }


if __name__ == "__main__":
    port = int(os.environ.get("COQUI_PORT", "5554"))
    host = os.environ.get("COQUI_HOST", "127.0.0.1")
    
    logger.info(f"Starting Coqui TTS server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
