'use client';

import { useState, useEffect, useCallback } from 'react';

interface TimelineControlProps {
  startTime: Date;
  endTime: Date;
  currentTime: Date;
  onTimeChange: (time: Date) => void;
  isPlaying: boolean;
  onPlayPause: (playing: boolean) => void;
  playbackSpeed?: number;
}

export default function TimelineControl({
  startTime,
  endTime,
  currentTime,
  onTimeChange,
  isPlaying,
  onPlayPause,
  playbackSpeed = 2000,
}: TimelineControlProps) {
  const [isDragging, setIsDragging] = useState(false);

  const totalDuration = endTime.getTime() - startTime.getTime();
  const currentPosition = currentTime.getTime() - startTime.getTime();
  const percentage = Math.max(0, Math.min(100, (currentPosition / totalDuration) * 100));

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newPercentage = parseFloat(e.target.value);
    const newTime = new Date(startTime.getTime() + (newPercentage / 100) * totalDuration);
    onTimeChange(newTime);
  }, [startTime, totalDuration, onTimeChange]);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const currentPos = currentTime.getTime() - startTime.getTime();
      const newPos = currentPos + playbackSpeed / 10;

      if (newPos >= totalDuration) {
        onTimeChange(endTime);
        onPlayPause(false);
      } else {
        const newTime = new Date(startTime.getTime() + newPos);
        onTimeChange(newTime);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, currentTime, startTime, endTime, totalDuration, playbackSpeed, onTimeChange, onPlayPause]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const handlePlayPause = () => {
    onPlayPause(!isPlaying);
  };

  const handleStepBack = () => {
    const stepTime = totalDuration / 100;
    const newTime = new Date(Math.max(startTime.getTime(), currentTime.getTime() - stepTime));
    onTimeChange(newTime);
  };

  const handleStepForward = () => {
    const stepTime = totalDuration / 100;
    const newTime = new Date(Math.min(endTime.getTime(), currentTime.getTime() + stepTime));
    onTimeChange(newTime);
  };

  return (
    <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-4 z-[1000] border border-gray-200">
      <div className="flex items-center gap-4">
        <button
          onClick={handlePlayPause}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 4h4v12H6V4zm4 0h4v12h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          )}
        </button>

        <button
          onClick={handleStepBack}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors"
          aria-label="Step back"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1 text-sm text-gray-600">
            <span className="truncate">{formatTime(startTime)}</span>
            <span className="font-semibold text-gray-900 px-2">{formatTime(currentTime)}</span>
            <span className="truncate">{formatTime(endTime)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={percentage}
            onChange={handleSliderChange}
            onMouseDown={() => setIsDragging(true)}
            onMouseUp={() => setIsDragging(false)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
          />
        </div>

        <button
          onClick={handleStepForward}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors"
          aria-label="Step forward"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #2563eb;
          cursor: pointer;
        }

        .slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #2563eb;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
}

