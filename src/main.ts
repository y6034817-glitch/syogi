import './styles/main.css';
import { mountApp } from './ui/app.ts';

const host = document.getElementById('app');
if (!host) throw new Error('#app が見つかりません');
mountApp(host);
