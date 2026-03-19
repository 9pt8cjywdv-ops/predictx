import React from 'react';

export default function Toast({ msg, type }) {
  return (
    <div className={`toast ${type}`}>
      {type === 'success' ? '✓ ' : '✗ '}{msg}
    </div>
  );
}
