import { Footer } from '@/components/ui/footer';
import { Navbar } from '@/components/ui/navbar';
import { Toaster } from '@/components/ui/sonner';
import { useTheme } from '@/context/theme-provider';
import { Outlet } from 'react-router-dom';

export const MainLayout = () => {
	const { theme } = useTheme();

	return (
		<>
			<Toaster position='top-right' richColors closeButton theme={theme} toastOptions={{}} />

			<div className='dark:hidden fixed inset-0 top-0 right-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]'></div>

			<div className='flex flex-col justify-between min-h-screen dark:text-white dark:bg-zinc-950'>
				<div>
					<Navbar />
					<main className='px-4 box-border py-4 md:py-8 flex flex-col w-full items-center'>
						<div className='max-w-[1400px] w-full'>
							<Outlet />
						</div>
					</main>
				</div>
				<div className='w-full flex justify-center p-4'>
					<div className='max-w-[1400px] w-full'>
						<Footer />
					</div>
				</div>
			</div>
		</>
	);
};
