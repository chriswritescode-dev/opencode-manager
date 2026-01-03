#!/usr/bin/env python3
"""
Chatterbox TTS Server
Runs as a subprocess managed by the OpenCode Manager backend.
Provides HTTP API for text-to-speech synthesis using Chatterbox-Turbo.
"""

import os
import sys
import io
import logging
import tempfile
from pathlib import Path
from typing import Optional

try:
    from fastapi import FastAPI, HTTPException, UploadFile, File, Form
    from fastapi.responses import StreamingResponse, JSONResponse
    import uvicorn
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fastapi", "uvicorn", "python-multipart"])
    from fastapi import FastAPI, HTTPException, UploadFile, File, Form
    from fastapi.responses import StreamingResponse, JSONResponse
    import uvicorn

try:
    import torch
    import torchaudio as ta
except ImportError:
    print("Installing torch and torchaudio...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "torch", "torchaudio"])
    import torch
    import torchaudio as ta

try:
    from chatterbox.tts import ChatterboxTTS
except ImportError:
    print("Installing chatterbox-tts...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "chatterbox-tts"])
    from chatterbox.tts import ChatterboxTTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Chatterbox TTS Server", version="1.0.0")

CHATTERBOX_PORT = int(os.environ.get("CHATTERBOX_PORT", "5553"))
CHATTERBOX_HOST = os.environ.get("CHATTERBOX_HOST", "127.0.0.1")
CHATTERBOX_DEVICE = os.environ.get("CHATTERBOX_DEVICE", "auto")
VOICE_SAMPLES_DIR = os.environ.get("CHATTERBOX_VOICE_SAMPLES_DIR", str(Path.home() / ".cache" / "chatterbox" / "voices"))

model: Optional[ChatterboxTTS] = None
device: str = "cpu"


def get_device() -> str:
    global device
    if CHATTERBOX_DEVICE == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = CHATTERBOX_DEVICE
    return device


def get_model() -> ChatterboxTTS:
    global model
    if model is None:
        dev = get_device()
        logger.info(f"Loading Chatterbox model on {dev}...")
        model = ChatterboxTTS.from_pretrained(device=dev)
        logger.info("Chatterbox model loaded successfully")
    return model


def get_voice_samples_path() -> Path:
    path = Path(VOICE_SAMPLES_DIR)
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_voice_samples() -> list[dict]:
    voices_path = get_voice_samples_path()
    voices = []
    
    voices.append({
        "id": "default",
        "name": "Default Voice",
        "description": "Built-in default voice (no reference audio)",
        "is_custom": False
    })
    
    for audio_file in voices_path.glob("*.wav"):
        voices.append({
            "id": audio_file.stem,
            "name": audio_file.stem.replace("_", " ").title(),
            "description": f"Custom voice from {audio_file.name}",
            "is_custom": True,
            "path": str(audio_file)
        })
    
    for audio_file in voices_path.glob("*.mp3"):
        voices.append({
            "id": audio_file.stem,
            "name": audio_file.stem.replace("_", " ").title(),
            "description": f"Custom voice from {audio_file.name}",
            "is_custom": True,
            "path": str(audio_file)
        })
    
    return voices


@app.on_event("startup")
async def startup_event():
    logger.info("Starting Chatterbox TTS Server...")
    logger.info(f"Voice samples directory: {VOICE_SAMPLES_DIR}")
    logger.info(f"Device preference: {CHATTERBOX_DEVICE}")
    try:
        get_model()
        logger.info("Chatterbox model pre-loaded successfully")
    except Exception as e:
        logger.warning(f"Could not pre-load model: {e}. Will load on first request.")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "device": device,
        "cuda_available": torch.cuda.is_available(),
        "mps_available": hasattr(torch.backends, "mps") and torch.backends.mps.is_available(),
    }


@app.get("/voices")
async def list_voices():
    voices = list_voice_samples()
    return {
        "voices": [v["id"] for v in voices],
        "voice_details": voices
    }


@app.post("/voices/upload")
async def upload_voice(
    audio: UploadFile = File(...),
    name: str = Form(...)
):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided")
    
    safe_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in name).lower()
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid voice name")
    
    suffix = Path(audio.filename).suffix.lower()
    if suffix not in [".wav", ".mp3", ".ogg", ".flac"]:
        raise HTTPException(status_code=400, detail="Unsupported audio format. Use WAV, MP3, OGG, or FLAC.")
    
    voices_path = get_voice_samples_path()
    output_path = voices_path / f"{safe_name}.wav"
    
    try:
        content = await audio.read()
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        try:
            waveform, sample_rate = ta.load(tmp_path)
            
            if sample_rate != 24000:
                resampler = ta.transforms.Resample(sample_rate, 24000)
                waveform = resampler(waveform)
            
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)
            
            ta.save(str(output_path), waveform, 24000)
        finally:
            os.unlink(tmp_path)
        
        return {
            "success": True,
            "voice_id": safe_name,
            "path": str(output_path)
        }
        
    except Exception as e:
        logger.error(f"Failed to upload voice: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/voices/{voice_id}")
async def delete_voice(voice_id: str):
    if voice_id == "default":
        raise HTTPException(status_code=400, detail="Cannot delete default voice")
    
    voices_path = get_voice_samples_path()
    
    for ext in [".wav", ".mp3"]:
        voice_file = voices_path / f"{voice_id}{ext}"
        if voice_file.exists():
            voice_file.unlink()
            return {"success": True, "deleted": voice_id}
    
    raise HTTPException(status_code=404, detail="Voice not found")


@app.post("/synthesize")
async def synthesize(request: dict):
    text = request.get("input") or request.get("text")
    voice_id = request.get("voice", "default")
    exaggeration = request.get("exaggeration", 0.5)
    cfg_weight = request.get("cfg_weight", 0.5)
    
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    
    if len(text) > 4096:
        raise HTTPException(status_code=400, detail="Text too long (max 4096 characters)")
    
    try:
        tts_model = get_model()
        
        audio_prompt_path = None
        if voice_id != "default":
            voices_path = get_voice_samples_path()
            for ext in [".wav", ".mp3"]:
                voice_file = voices_path / f"{voice_id}{ext}"
                if voice_file.exists():
                    audio_prompt_path = str(voice_file)
                    break
        
        logger.info(f"Synthesizing text with voice '{voice_id}' (prompt: {audio_prompt_path})")
        
        if audio_prompt_path:
            wav = tts_model.generate(
                text,
                audio_prompt_path=audio_prompt_path,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight
            )
        else:
            wav = tts_model.generate(
                text,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight
            )
        
        buffer = io.BytesIO()
        ta.save(buffer, wav, tts_model.sr, format="wav")
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
    model = request.get("model", "chatterbox")
    speed = request.get("speed", 1.0)
    response_format = request.get("response_format", "mp3")
    
    if not text:
        raise HTTPException(status_code=400, detail="No input text provided")
    
    if len(text) > 4096:
        raise HTTPException(status_code=400, detail="Text too long (max 4096 characters)")
    
    try:
        tts_model = get_model()
        
        audio_prompt_path = None
        if voice != "default":
            voices_path = get_voice_samples_path()
            for ext in [".wav", ".mp3"]:
                voice_file = voices_path / f"{voice}{ext}"
                if voice_file.exists():
                    audio_prompt_path = str(voice_file)
                    break
        
        logger.info(f"OpenAI-compatible synthesis: voice='{voice}', format='{response_format}'")
        
        if audio_prompt_path:
            wav = tts_model.generate(text, audio_prompt_path=audio_prompt_path)
        else:
            wav = tts_model.generate(text)
        
        buffer = io.BytesIO()
        
        if response_format == "mp3":
            try:
                ta.save(buffer, wav, tts_model.sr, format="mp3")
                content_type = "audio/mpeg"
            except Exception:
                ta.save(buffer, wav, tts_model.sr, format="wav")
                content_type = "audio/wav"
        elif response_format == "opus":
            ta.save(buffer, wav, tts_model.sr, format="ogg")
            content_type = "audio/ogg"
        elif response_format == "aac":
            ta.save(buffer, wav, tts_model.sr, format="wav")
            content_type = "audio/wav"
        elif response_format == "flac":
            ta.save(buffer, wav, tts_model.sr, format="flac")
            content_type = "audio/flac"
        else:
            ta.save(buffer, wav, tts_model.sr, format="wav")
            content_type = "audio/wav"
        
        buffer.seek(0)
        
        return StreamingResponse(
            buffer,
            media_type=content_type
        )
        
    except Exception as e:
        logger.error(f"OpenAI-compatible synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/audio/voices")
async def openai_compatible_list_voices():
    voices = list_voice_samples()
    return {
        "data": [
            {
                "id": v["id"],
                "name": v["name"],
                "description": v.get("description", ""),
            }
            for v in voices
        ]
    }


if __name__ == "__main__":
    port = int(os.environ.get("CHATTERBOX_PORT", "5553"))
    host = os.environ.get("CHATTERBOX_HOST", "127.0.0.1")
    
    logger.info(f"Starting Chatterbox server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
