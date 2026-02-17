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
  const dragState = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    baseRect: null as DOMRect | null,
  });

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    const isInteractive = Boolean(target.closest(interactiveSelector));
    const isHandle = Boolean(target.closest('[data-drag-handle="true"]'));
    if (isInteractive && !isHandle) {
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
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
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
      return;
    }
    dragState.current.dragging = false;
    panelRef.current?.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      {...props}
      ref={panelRef}
      data-draggable-modal="true"
      style={{ ...style, transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
      className={className}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {children}
    </div>
  );
}
