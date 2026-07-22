"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

const PULL_THRESHOLD_RATIO = 0.4;
const PULL_MAX_RATIO = 0.5;

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  while (el && el !== document.documentElement && el !== document.body) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

function isAtTop(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return window.scrollY <= 0;
  }
  const scrollable = findScrollableAncestor(target);
  return !scrollable || scrollable.scrollTop <= 0;
}

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const startYRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const resetPull = useCallback(() => {
    setTransitioning(true);
    setPullDistance(0);
    pullDistanceRef.current = 0;
    window.requestAnimationFrame(() => {
      window.setTimeout(() => setTransitioning(false), 220);
    });
  }, []);

  const triggerRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
      resetPull();
    }
  }, [queryClient, resetPull]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (refreshing || event.button !== 0) return;
    if (!isAtTop(event.target)) return;
    startYRef.current = event.clientY;
    pointerIdRef.current = event.pointerId;
    isDraggingRef.current = true;
    setTransitioning(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || pointerIdRef.current !== event.pointerId) return;
    if (startYRef.current === null) return;
    const delta = event.clientY - startYRef.current;
    if (delta <= 0) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }

    const maxDistance = window.innerHeight * PULL_MAX_RATIO;
    const nextDistance = Math.min(delta, maxDistance);
    pullDistanceRef.current = nextDistance;
    setPullDistance(nextDistance);
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  const finishDrag = async (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || pointerIdRef.current !== event.pointerId) return;
    isDraggingRef.current = false;
    pointerIdRef.current = null;
    startYRef.current = null;

    const threshold = window.innerHeight * PULL_THRESHOLD_RATIO;
    if (pullDistanceRef.current >= threshold) {
      setPullDistance(threshold);
      pullDistanceRef.current = threshold;
      await triggerRefresh();
      return;
    }

    resetPull();
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || pointerIdRef.current !== event.pointerId) return;
    isDraggingRef.current = false;
    pointerIdRef.current = null;
    startYRef.current = null;
    resetPull();
  };

  const pullProgress = Math.min(pullDistance / (window.innerHeight * PULL_THRESHOLD_RATIO), 1);
  const shouldShowIndicator = isDraggingRef.current && pullDistance > 0;

  return (
    <div
      className="relative overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={handlePointerCancel}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
        {/* Pull progress indicator */}
        {shouldShowIndicator && (
          <div
            className="mt-2 h-7 w-7 rounded-full border-2 border-primary/40 transition-all"
            style={{
              opacity: Math.min(pullProgress + 0.3, 1),
              borderColor: pullProgress >= 1 ? "rgb(var(--color-primary))" : "rgba(var(--color-primary-rgb), 0.4)",
              boxShadow: pullProgress >= 1 ? "0 0 0 4px rgba(var(--color-primary-rgb), 0.1)" : "none",
            }}
          >
            <div
              className="absolute inset-0 rounded-full transition-all"
              style={{
                background: `conic-gradient(rgb(var(--color-primary)), rgb(var(--color-primary)) ${pullProgress * 100}%, transparent ${pullProgress * 100}%)`,
                opacity: Math.max(pullProgress - 0.2, 0) * 0.6,
              }}
            />
          </div>
        )}
        {/* Loading spinner during refresh */}
        <div
          className={cn(
            "mt-3 h-8 w-8 rounded-full border-2 border-primary border-t-transparent transition-opacity",
            refreshing ? "opacity-100 animate-spin" : "opacity-0",
          )}
        />
      </div>
      <div
        className="min-h-full"
        style={{
          transform: pullDistance ? `translateY(${pullDistance}px)` : undefined,
          transition: transitioning || refreshing ? "transform 220ms ease" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
