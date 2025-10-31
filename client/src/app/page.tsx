'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import TimelineControl from '@/components/TimelineControl';
import { generateFoodTimelineData } from '@/data/generateFoodTimelineData';

const MapTimeline = dynamic(() => import('@/components/MapTimeline'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const { nodes, events, shipments, shipmentLocations, batches } = useMemo(() => generateFoodTimelineData(), []);

  const { startTime, endTime } = useMemo(() => {
    if (events.length === 0) {
      const now = new Date();
      return {
        startTime: new Date(now.getTime() - 20000),
        endTime: now,
      };
    }

    const times = events.map((e) => e.time.getTime());
    return {
      startTime: new Date(Math.min(...times)),
      endTime: new Date(Math.max(...times)),
    };
  }, [events]);

  const [currentTime, setCurrentTime] = useState(startTime);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="w-screen h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm z-10">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900">Food Timeline Animation</h1>
          <p className="text-sm text-gray-600 mt-1">
            Visualize food supply chain data over time on an interactive map
          </p>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0">
          <MapTimeline
            nodes={nodes}
            events={events}
            shipments={shipments}
            shipmentLocations={shipmentLocations}
            batches={batches}
            currentTime={currentTime}
            startTime={startTime}
            endTime={endTime}
          />
        </div>

        <TimelineControl
          startTime={startTime}
          endTime={endTime}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          isPlaying={isPlaying}
          onPlayPause={setIsPlaying}
          playbackSpeed={2000}
        />

        <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-4 z-[1000] border border-gray-200">
          <h3 className="font-semibold text-sm mb-3 text-gray-900">Node Types</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-sm"></div>
              <span className="text-sm text-gray-700">🌾 Farm</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm"></div>
              <span className="text-sm text-gray-700">🏭 Processing</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-amber-500 border-2 border-white shadow-sm"></div>
              <span className="text-sm text-gray-700">📦 Warehouse</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-sm"></div>
              <span className="text-sm text-gray-700">❤️ NGO</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h3 className="font-semibold text-sm mb-2 text-gray-900">Shipments</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-amber-500 border-dashed"></div>
                <span className="text-xs text-gray-700">In Transit</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 bg-purple-500 border-dashed"></div>
                <span className="text-xs text-gray-700">Reserved</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
