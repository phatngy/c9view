import { Button, type ButtonProps } from './Button.js';
export interface IconButtonProps extends Omit<ButtonProps, 'aria-label'> {
  label: string;
}
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: IconButtonProps) {
  return (
    <Button
      {...props}
      data-dense
      variant={variant}
      size={size}
      aria-label={label}
      className={`w-11 px-0 ${size === 'sm' ? 'sm:w-9' : 'sm:w-10'} ${className ?? ''}`}
    />
  );
}
