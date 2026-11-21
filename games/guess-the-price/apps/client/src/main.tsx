import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { MainPage } from './pages/main-page';
import { ClassicModePage } from './pages/classic-mode-page';
import { MainLayout } from './layouts/main-layout';
import './index.css';
import { ThisOrThatPage } from './pages/this-that-page';
import { MultiplayerJoinPage } from './pages/multiplayer-join-page';
import { MultiplayerPage } from './pages/multiplayer-page';
import { ThemeProvider } from './context/theme-provider';

const basename = typeof window !== 'undefined' && window.location.pathname.startsWith('/price-guess') ? '/price-guess' : '/';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ThemeProvider defaultTheme='light' storageKey='theme'>
			<BrowserRouter basename={basename}>
				<Routes>
					<Route element={<MainLayout />}>
						<Route path='/' element={<MainPage />} />
						<Route path='/classic-mode' element={<ClassicModePage />} />
						<Route path='/this-that' element={<ThisOrThatPage />} />
						<Route path='/multiplayer' element={<MultiplayerJoinPage />} />
						<Route path='/multiplayer/:id' element={<MultiplayerPage />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</ThemeProvider>
	</StrictMode>
);
