import type { ReactElement } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Check } from 'lucide-react';
import { popup, option } from './classes.js';
export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
}
export interface MenuRadioGroup {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  items: { value: string; label: string; disabled?: boolean }[];
}
export interface MenuProps {
  trigger: ReactElement;
  items?: MenuItem[];
  radioGroup?: MenuRadioGroup;
}
export function Menu({ trigger, items = [], radioGroup }: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align="end" className="z-50">
          <BaseMenu.Popup className={`${popup} min-w-40`}>
            {items.map((item) => (
              <BaseMenu.Item
                key={item.label}
                disabled={item.disabled}
                onClick={item.onSelect}
                className={option}
              >
                {item.label}
              </BaseMenu.Item>
            ))}
            {radioGroup && (
              <BaseMenu.RadioGroup
                aria-label={radioGroup.label}
                value={radioGroup.value}
                onValueChange={(value: unknown) => {
                  if (typeof value === 'string')
                    radioGroup.onValueChange(value);
                }}
              >
                {radioGroup.items.map((item) => (
                  <BaseMenu.RadioItem
                    closeOnClick
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                    className={option}
                  >
                    <span>{item.label}</span>
                    <BaseMenu.RadioItemIndicator className="ml-auto">
                      <Check size={14} aria-hidden="true" />
                    </BaseMenu.RadioItemIndicator>
                  </BaseMenu.RadioItem>
                ))}
              </BaseMenu.RadioGroup>
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
