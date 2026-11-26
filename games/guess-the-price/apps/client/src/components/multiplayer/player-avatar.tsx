import { useState } from 'react';
import { useMpStore } from '@/stores/mp-store';

interface Props {
	name: string;
	size?: number;
	className?: string;
}

/**
 * Avatar aus dem Treffen-Hub (vom party-server als SVG gerendert). Ohne Hub-Avatar – GTP einzeln
 * gestartet oder Spieler schon aus dem Hub-Raum weg (404) – erscheint der Anfangsbuchstabe.
 */
export const PlayerAvatar = ({ name, size = 32, className = '' }: Props) => {
	const url = useMpStore(state => state.playerAvatars?.[name]);
	const [failed, setFailed] = useState<string | null>(null);
	const style = { width: size, height: size };

	if (url && failed !== url) {
		return (
			<img
				src={url}
				alt=''
				aria-hidden='true'
				draggable={false}
				style={style}
				className={`shrink-0 rounded-full bg-zinc-800 ${className}`}
				onError={() => setFailed(url)}
				data-testid='gtp-avatar'
			/>
		);
	}
	return (
		<span
			aria-hidden='true'
			style={{ ...style, fontSize: size * 0.45 }}
			className={`shrink-0 rounded-full inline-flex items-center justify-center font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 ${className}`}
		>
			{(name.trim()[0] || '?').toUpperCase()}
		</span>
	);
};
