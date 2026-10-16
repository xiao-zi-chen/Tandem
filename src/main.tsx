import { writeLocal } from './storage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './review.css';
import type {} from '../shared/desktop';

if (window.tandem) {
  const preferences = await window.tandem.preferences();
  if (preferences.locale) writeLocal('tandem.locale', preferences.locale);
  if (preferences.selectedTaskId) writeLocal('tandem.selected', preferences.selectedTaskId);
  document.documentElement.dataset.desktop = 'true';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
