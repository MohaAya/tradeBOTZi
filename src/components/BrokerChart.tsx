import React, { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
  type Time,
} from 'lightweight-charts';

type Props = {
  symbol: string;
  fills: any[];
  positions: any[];
  bookId: string;
};

export default function BrokerChart({ symbol, fills, positions, bookId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<any>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [candles, setCandles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await fetch('/api/history?symbols=' + encodeURIComponent(symbol) + '&interval=1h&limit=240', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.history?.[symbol]) setCandles(data.history[symbol]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [symbol]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.045)' },
        horzLines: { color: 'rgba(255,255,255,0.045)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(34,211,238,0.35)' },
        horzLine: { color: 'rgba(34,211,238,0.35)' },
      },
      autoSize: true,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
      borderVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(candle, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !candles.length) return;

    candleRef.current.setData(candles.map(c => ({
      time: Math.floor(Number(c.timestamp) / 1000) as UTCTimestamp,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    })));

    volumeRef.current.setData(candles.map(c => ({
      time: Math.floor(Number(c.timestamp) / 1000) as UTCTimestamp,
      value: Number(c.volume || 0),
      color: Number(c.close) >= Number(c.open)
        ? 'rgba(16,185,129,0.28)'
        : 'rgba(239,68,68,0.28)',
    })));

    chartRef.current?.timeScale().fitContent();
  }, [candles, symbol]);

  useEffect(() => {
    if (!markersRef.current || !candles.length) return;
    const first = Number(candles[0]?.timestamp || 0);
    const last = Number(candles[candles.length - 1]?.timestamp || Date.now());
    const markers = fills
      .filter(fill => fill.symbol === symbol && fill.bookId === bookId)
      .filter(fill => Number(fill.timestamp) >= first - 3600000 && Number(fill.timestamp) <= last + 3600000)
      .map(fill => {
        const isOpen = fill.action === 'OPEN';
        const long = fill.positionSide === 'LONG';
        return {
          time: Math.floor(Number(fill.timestamp) / 3600000) * 3600 as Time,
          position: long ? 'belowBar' as const : 'aboveBar' as const,
          color: long ? '#10b981' : '#ef4444',
          shape: long ? 'arrowUp' as const : 'arrowDown' as const,
          text: (isOpen ? 'OPEN ' : 'CLOSE ') + fill.positionSide + ' · ' + (fill.strategy || ''),
        };
      })
      .sort((a, b) => Number(a.time) - Number(b.time));
    markersRef.current.setMarkers(markers);
  }, [fills, symbol, bookId, candles]);

  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line); } catch {}
    }
    priceLinesRef.current = [];

    const position = positions.find(p => p.symbol === symbol && p.bookId === bookId);
    if (!position) return;

    const defs = [
      { price: Number(position.entryPrice), title: 'ENTRY', lineColor: '#60a5fa' },
      { price: Number(position.stopLossPrice), title: 'STOP', lineColor: '#ef4444' },
      { price: Number(position.takeProfitPrice), title: 'TARGET', lineColor: '#10b981' },
    ].filter(x => Number.isFinite(x.price) && x.price > 0);

    priceLinesRef.current = defs.map(def => series.createPriceLine({
      price: def.price,
      color: def.lineColor,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: def.title,
    }));
  }, [positions, symbol, bookId]);

  return (
    <div className="relative w-full h-full min-h-[460px]">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-500 bg-gray-950/40">
          Loading real candles…
        </div>
      )}
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
