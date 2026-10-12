import { PrismaClient } from '@prisma/client';
import { seedCategories, seedProducts } from './seed.data';

async function main() {
	const prisma = new PrismaClient();

	try {
		//Clear database
		await prisma.product.deleteMany();
		await prisma.category.deleteMany();

		//Insert mock information
		await prisma.category.createMany({ data: seedCategories });
		await prisma.product.createMany({ data: seedProducts });

		console.log('Seed procedure completed successfully!');
	} catch (error) {
		console.error('Seed procedure failed:\n' + error);
	} finally {
		await prisma.$disconnect();
	}
}

main();
