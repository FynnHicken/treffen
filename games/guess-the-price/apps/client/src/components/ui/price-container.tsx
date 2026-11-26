import CountUp from 'react-countup';

interface Props {
	price: number;
	animate?: boolean;
	animationDuration?: number;
	className?: string;
}

export const PriceContainer = ({ className, price, animate, animationDuration }: Props) => {
	return (
		<h2 className={className}>
			<CountUp end={price} separator='.' decimal=',' decimals={2} suffix=' €' duration={animate ? (animationDuration ?? 0.5) : 0.01} />
		</h2>
	);
};
