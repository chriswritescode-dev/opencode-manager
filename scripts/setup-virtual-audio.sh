#!/bin/bash
set -e

echo "Setting up virtual audio devices for CI testing..."

# Install PulseAudio if not present
if ! command -v pulseaudio &> /dev/null; then
    echo "Installing PulseAudio..."
    sudo apt-get update
    sudo apt-get install -y pulseaudio pulseaudio-utils
fi

# Start PulseAudio in system mode for CI
echo "Starting PulseAudio..."
pulseaudio --check 2>/dev/null || pulseaudio --start --exit-idle-time=-1

# Wait for PulseAudio to be ready
sleep 2

# Create a null sink (virtual speaker) that we can monitor
echo "Creating virtual speaker (null sink)..."
pactl load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual_Speaker"

# Create a virtual source (microphone) from the null sink's monitor
echo "Creating virtual microphone..."
pactl load-module module-virtual-source source_name=virtual_mic master=virtual_speaker.monitor source_properties=device.description="Virtual_Microphone"

# Set the virtual mic as the default source
echo "Setting virtual mic as default source..."
pactl set-default-source virtual_mic

# Verify setup
echo ""
echo "Virtual audio setup complete!"
echo "Available sources:"
pactl list short sources

echo ""
echo "Default source:"
pactl get-default-source

echo ""
echo "To inject audio into the virtual mic, play audio to the virtual_speaker sink:"
echo "  paplay --device=virtual_speaker audio.wav"
echo "  ffplay -f lavfi -i 'sine=frequency=440:duration=2' -nodisp -autoexit | paplay --device=virtual_speaker"
