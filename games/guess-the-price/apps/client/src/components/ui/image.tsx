import { useState } from 'react';

interface Props {
	src: string;
	alt: string;
	className?: string;
}

export const Image = ({ src, alt, className }: Props) => {
	const [loading, setLoading] = useState(true);

	return (
		<div
			className={`${className ?? 'w-[300px] '} aspect-square relative overflow-hidden rounded-md ${loading ? 'bg-zinc-200 dark:bg-zinc-800 animate-pulse' : 'bg-zinc-100 dark:bg-zinc-900'}`}
		>
			<img
				src={src}
				alt={alt}
				className='absolute inset-0 w-full h-full object-contain rounded-md'
				onLoad={() => setLoading(false)}
			/>
		</div>
	);
};
