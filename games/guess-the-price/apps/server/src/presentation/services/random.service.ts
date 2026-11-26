import { PrismaClient } from '@prisma/client';
import { ControllerError } from '../../domain/errors/controller-error';
import { checkControllerError } from '../../domain/errors/handlers/handle-controller-error';

export class RandomService {
	private static prisma = new PrismaClient();
	private static productSelectProperties = {
		id: true,
		name: true,
		description: true,
		image: true,
		source: true,
		price: true,
		priceMessage: true,
		category: {
			select: {
				name: true,
			},
		},
	};

	public static countProducts = async () => this.prisma.product.count();

	public static getRandomProduct = async (ignore: string[], category?: string) => {
		try {
			const productCount = await this.prisma.product.count({
				where: { id: { notIn: ignore }, categoryId: category },
			});

			if (!productCount) {
				throw new ControllerError("Couldn't find any product.", 404);
			}

			const randomProduct = await this.prisma.product.findMany({
				orderBy: { id: 'desc' },
				where: { id: { notIn: ignore }, categoryId: category },
				skip: Math.floor(Math.random() * productCount),
				take: 1,
				select: this.productSelectProperties,
			});

			if (!randomProduct[0]) {
				throw new ControllerError("Couldn't find any product.", 404);
			}

			const { price, ...rest } = randomProduct[0];
			return { ...rest, price: Number(price) };
		} catch (error) {
			console.error(error);
			checkControllerError(error as Error, 'Could not get random product');
		}
	};

	/**
	 * „Was ist teurer?“: das aktuelle Produkt (oder ein zufälliges) plus ein zweites mit ähnlicher
	 * Preisklasse (Faktor 0,4–2,5), damit es nicht zu leicht wird. Gibt es keins, irgendein anderes.
	 */
	public static getRandomProductHighLow = async (currentProductId: string, ignore: string[]) => {
		try {
			const toProduct = <T extends { price: unknown }>(p: T) => ({ ...p, price: Number(p.price) });

			const current = currentProductId
				? await this.prisma.product.findUnique({ where: { id: currentProductId }, select: this.productSelectProperties })
				: null;
			const first = current ? toProduct(current) : await this.getRandomProduct(ignore);
			if (!first) throw new ControllerError('Kein Produkt gefunden.', 404);

			const others = await this.prisma.product.findMany({
				where: { id: { notIn: [...ignore, first.id] } },
				select: this.productSelectProperties,
			});
			if (!others.length) throw new ControllerError('Kein zweites Produkt gefunden.', 404);

			const price = Number(first.price);
			const similar = others.filter(p => {
				const ratio = Number(p.price) / price;
				return ratio >= 0.4 && ratio <= 2.5 && Number(p.price) !== price;
			});
			const pool = similar.length ? similar : others;
			const second = pool[Math.floor(Math.random() * pool.length)];

			return { selectedProduct: first, newProduct: toProduct(second) };
		} catch (error) {
			console.error(error);
			checkControllerError(error as Error, 'Could not get random product high low');
		}
	};
}
