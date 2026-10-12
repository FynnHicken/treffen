import { Link } from 'react-router-dom';
import { ThemeToggle } from './theme-toggle';
import { useTheme } from '@/context/theme-provider';

export const Navbar = () => {
	const { theme } = useTheme();
	const base = import.meta.env.BASE_URL || '/';

	return (
		<nav className='p-5 flex justify-between'>
			<Link to='/'>
				<img src={`${base}images/${theme == 'dark' ? 'd-' : ''}logo.svg`} alt='Guess the price logo' className='w-[260px]' />
			</Link>
			<div>
				<ThemeToggle />
			</div>
		</nav>
	);
};
