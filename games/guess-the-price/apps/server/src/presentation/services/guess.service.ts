import { PrismaClient } from '@prisma/client';
import { ControllerError } from '../../domain/errors/controller-error';
import { checkControllerError } from '../../domain/errors/handlers/handle-controller-error';

const DIFFERENCE_LIMIT = 40;

export class GuessService {
	private static prisma = new PrismaClient();

	public static guessProductPrice = async (productId: string, guessedPrice: number) => {
		try {
			const product = await this.prisma.product.findFirst({ where: { id: productId } });

			if (!product) {
				throw new ControllerError('Product not found', 404);
			}

			const productPrice = Number(product.price);
			const diffPercentage = Math.abs(Math.floor(guessedPrice / (productPrice / 100) - 100));
			let points = 0;

			if (diffPercentage == 0) {
				points = 100;
			} else if (diffPercentage >= DIFFERENCE_LIMIT) {
				points = 0;
			} else {
				points = 100 - diffPercentage * (100 / DIFFERENCE_LIMIT);
			}

			return { originalPrice: productPrice, guessedPrice, points: Math.ceil(points) };
		} catch (error) {
			console.error(error);
			checkControllerError(error as Error, `Cannot guess the price for product ${productId}`);
		}
	};
}
