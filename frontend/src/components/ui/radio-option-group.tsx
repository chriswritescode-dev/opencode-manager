export interface RadioOption<T extends string> {
  value: T
  label: string
  description?: string
}

interface RadioOptionGroupProps<T extends string> {
  name: string
  value: T
  onChange: (value: T) => void
  options: Array<RadioOption<T>>
}

export function RadioOptionGroup<T extends string>({
  name,
  value,
  onChange,
  options,
}: RadioOptionGroupProps<T>) {
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-0.5"
          />
          <span>
            <span className="block">{option.label}</span>
            {option.description && (
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}
