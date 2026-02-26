'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { useRef, useState } from 'react';

type DraggablePanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

const interactiveSelector =
  'button, a, input, textarea, select, option, label, [data-no-drag="true"]';

export function DraggablePanel({ children, className = '', style, ...props }: DraggablePanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isHandleHover, setIsHandleHover] = useState(false);
  const dragState = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    baseRect: null as DOMRect | null,
  });
  const defaultHandleHeight = 84;

  const isInHandleArea = (target: HTMLElement, clientY: number) => {
    const panel = panelRef.current;
    if (!panel) {
      return false;
    }
    const explicitHandle = target.closest('[data-drag-handle="true"]');
    if (explicitHandle) {
      return true;
    }
    const rect = panel.getBoundingClientRect();
    return clientY - rect.top <= defaultHandleHeight;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    const isInteractive = Boolean(target.closest(interactiveSelector));
    if (isInteractive) {
      return;
    }
    const isHandle = isInHandleArea(target, event.clientY);
    if (!isHandle) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    dragState.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      baseRect: panel.getBoundingClientRect(),
    };
    panel.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!dragState.current.dragging) {
      const isInteractive = Boolean(target.closest(interactiveSelector));
      const overHandle = !isInteractive && isInHandleArea(target, event.clientY);
      if (overHandle !== isHandleHover) {
        setIsHandleHover(overHandle);
      }
      return;
    }
    if (!dragState.current.dragging || !dragState.current.baseRect) {
      return;
    }
    const dx = event.clientX - dragState.current.startX;
    const dy = event.clientY - dragState.current.startY;
    const padding = 24;
    const baseRect = dragState.current.baseRect;
    const minDx = padding - baseRect.left;
    const maxDx = window.innerWidth - padding - baseRect.right;
    const minDy = padding - baseRect.top;
    const maxDy = window.innerHeight - padding - baseRect.bottom;
    const clampedDx = Math.min(maxDx, Math.max(minDx, dx));
    const clampedDy = Math.min(maxDy, Math.max(minDy, dy));
    setPosition({
      x: dragState.current.originX + clampedDx,
      y: dragState.current.originY + clampedDy,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.dragging) {
      setIsHandleHover(false);
      return;
    }
    dragState.current.dragging = false;
    panelRef.current?.releasePointerCapture(event.pointerId);
    setIsDragging(false);
    setIsHandleHover(false);
  };

  return (
    <div
      {...props}
      ref={panelRef}
      data-draggable-modal="true"
      style={{ ...style, transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      className={`${className} ${
        isDragging
          ? 'opacity-[0.985] shadow-[0_30px_70px_rgba(15,23,42,0.28)]'
          : isHandleHover
            ? 'cursor-move'
            : ''
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        if (!dragState.current.dragging) {
          setIsHandleHover(false);
        }
      }}
    >
      {children}
    </div>
  );
}
