import React from 'react';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	DialogClose,
} from '@/components/ui/dialog';
import { Button } from './button';

interface Props {
	title: string;
	description: string;
	children: React.ReactNode;
	onConfirm: () => void;
}

export const DestructiveActionButton = ({ title, description, children, onConfirm }: Props) => {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant='destructive'>{children}</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className='text-start dark:text-white'>{title}</DialogTitle>
					<DialogDescription className='text-start'>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter className='flex gap-2'>
					<DialogClose asChild>
						<Button>Abbrechen</Button>
					</DialogClose>
					<Button
						variant='destructive'
						onClick={() => {
							onConfirm();
						}}
					>
						{children}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
