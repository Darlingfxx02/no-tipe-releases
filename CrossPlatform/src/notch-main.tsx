import React from 'react';
import { createRoot } from 'react-dom/client';
import { Notch } from './Notch';
import './notch.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><Notch/></React.StrictMode>);
