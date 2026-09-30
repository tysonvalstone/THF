"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DAY_MINUTES } from "@/lib/harvest/engine";

/** Real seconds for the whole day at 1× */
export const DAY_SECONDS = 60;
export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** Per-frame callback: sim minute, real seconds since the last frame, and whether the time jumped (seek) */
export type FrameFn = (t: number, dt: number, jumped: boolean) => void;

export interface SimClock {
  /** Current sim minute (0 = 5:00 am), read in frame callbacks */
  time: () => number;
  /** Whole minutes, for React-rendered counters */
  minute: number;
  playing: boolean;
  ended: boolean;
  speed: Speed;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  seek: (t: number) => void;
  setSpeed: (s: Speed) => void;
  subscribe: (fn: FrameFn) => () => void;
}

/**
 * One clock for one or two scenes: a requestAnimationFrame loop advances the
 * day (5 am to 11 pm in ~60 s at 1×) and calls every subscriber each frame.
 */
export function useSimClock(opts: { autoPlay?: boolean } = {}): SimClock {
  const t = useRef(0);
  const jumped = useRef(true);
  const subs = useRef(new Set<FrameFn>());
  const [minute, setMinute] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(1);
  const playingRef = useRef(false);
  const speedRef = useRef<Speed>(1);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        t.current = Math.min(DAY_MINUTES, t.current + dt * (DAY_MINUTES / DAY_SECONDS) * speedRef.current);
        if (t.current >= DAY_MINUTES) {
          playingRef.current = false;
          setPlaying(false);
        }
      }
      const j = jumped.current;
      jumped.current = false;
      subs.current.forEach((fn) => fn(t.current, dt, j));
      const m = Math.floor(t.current);
      setMinute((prev) => (prev === m ? prev : m));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const play = useCallback(() => {
    if (t.current >= DAY_MINUTES) {
      t.current = 0;
      jumped.current = true;
    }
    playingRef.current = true;
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);
  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);
  const seek = useCallback((m: number) => {
    t.current = Math.max(0, Math.min(DAY_MINUTES, m));
    jumped.current = true;
    setMinute(Math.floor(t.current));
  }, []);
  const restart = useCallback(() => {
    seek(0);
    playingRef.current = true;
    setPlaying(true);
  }, [seek]);
  const setSpeed = useCallback((s: Speed) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);
  const subscribe = useCallback((fn: FrameFn) => {
    subs.current.add(fn);
    jumped.current = true;
    return () => void subs.current.delete(fn);
  }, []);
  const time = useCallback(() => t.current, []);

  useEffect(() => {
    if (!opts.autoPlay) return;
    const id = setTimeout(play, 400);
    return () => clearTimeout(id);
  }, [opts.autoPlay, play]);

  return useMemo(
    () => ({ time, minute, playing, ended: minute >= DAY_MINUTES, speed, play, pause, toggle, restart, seek, setSpeed, subscribe }),
    [time, minute, playing, speed, play, pause, toggle, restart, seek, setSpeed, subscribe],
  );
}
