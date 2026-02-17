'use client';

import { useEffect } from 'react';

let isLocked = false;
let lockedScrollY = 0;

const lockBody = () => {
  if (isLocked) {
    return;
  }
  lockedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
  isLocked = true;
};

const unlockBody = () => {
  if (!isLocked) {
    return;
  }
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  window.scrollTo(0, lockedScrollY);
  isLocked = false;
};

export function ModalScrollLock() {
  useEffect(() => {
    const updateLock = () => {
      const hasModal = Boolean(document.querySelector('[data-modal-overlay="true"]'));
      if (hasModal) {
        lockBody();
      } else {
        unlockBody();
      }
    };

    updateLock();
    const observer = new MutationObserver(updateLock);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      unlockBody();
    };
  }, []);

  return null;
}
