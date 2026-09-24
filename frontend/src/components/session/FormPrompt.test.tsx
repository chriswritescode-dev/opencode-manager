import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FormInfo } from '@opencode-manager/shared/opencode'
import { FormPrompt } from './FormPrompt'

const selectForm: FormInfo = {
  id: 'form-1',
  sessionID: 'session-1',
  title: 'Deploy to prod?',
  fields: [
    {
      key: 'q0',
      title: 'Environment',
      type: 'string',
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'production', label: 'Production' },
      ],
    },
  ],
}

describe('FormPrompt', () => {
  it('submits the selected option keyed by field key', async () => {
    const onReply = vi.fn().mockResolvedValue(undefined)
    render(<FormPrompt form={selectForm} onReply={onReply} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByText('Production'))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(onReply).toHaveBeenCalledWith('form-1', { q0: 'production' }))
  })

  it('collects multiselect, boolean, and number answers', async () => {
    const onReply = vi.fn().mockResolvedValue(undefined)
    const form: FormInfo = {
      id: 'form-2',
      sessionID: 'session-1',
      title: 'Configure',
      fields: [
        {
          key: 'features',
          type: 'multiselect',
          options: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
          ],
        },
        { key: 'enabled', type: 'boolean' },
        { key: 'count', type: 'integer', minimum: 1 },
      ],
    }
    render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByText('Alpha'))
    await userEvent.click(screen.getByText('No'))
    const numberInput = screen.getByRole('spinbutton')
    await userEvent.clear(numberInput)
    await userEvent.type(numberInput, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(onReply).toHaveBeenCalledWith('form-2', { features: ['a'], enabled: false, count: 3 }),
    )
  })

  it('cancels the form', async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined)
    render(<FormPrompt form={selectForm} onReply={vi.fn()} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(onCancel).toHaveBeenCalledWith('form-1'))
  })

  describe('field defaults', () => {
    it('initializes a required numeric default and allows submission as displayed', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-numeric-default',
        sessionID: 'session-1',
        title: 'Configure',
        fields: [{ key: 'count', title: 'Count', type: 'integer', required: true, default: 3 }],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      const input = screen.getByLabelText(/Count/) as HTMLInputElement
      expect(input.value).toBe('3')
      const submit = screen.getByRole('button', { name: 'Submit' })
      expect(submit).toBeEnabled()

      await userEvent.click(submit)
      await waitFor(() => expect(onReply).toHaveBeenCalledWith('form-numeric-default', { count: 3 }))
    })

    it('keeps a cleared numeric default cleared and re-enables gating', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-numeric-clear',
        sessionID: 'session-1',
        title: 'Configure',
        fields: [{ key: 'count', title: 'Count', type: 'integer', required: true, default: 3 }],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      const input = screen.getByLabelText(/Count/) as HTMLInputElement
      const submit = screen.getByRole('button', { name: 'Submit' })

      await userEvent.clear(input)
      expect(input.value).toBe('')
      expect(submit).toBeDisabled()

      await userEvent.type(input, '5')
      expect(submit).toBeEnabled()
      await userEvent.click(submit)
      await waitFor(() => expect(onReply).toHaveBeenCalledWith('form-numeric-clear', { count: 5 }))
    })

    it('initializes string, boolean, and multiselect defaults', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-mixed-defaults',
        sessionID: 'session-1',
        title: 'Configure',
        fields: [
          { key: 'name', title: 'Name', type: 'string', required: true, default: 'Ada' },
          { key: 'enabled', title: 'Enabled', type: 'boolean', required: true, default: false },
          {
            key: 'features',
            title: 'Features',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
            ],
            default: ['a'],
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      expect((screen.getByLabelText(/Name/) as HTMLTextAreaElement).value).toBe('Ada')
      expect(screen.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'true')

      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-mixed-defaults', {
          name: 'Ada',
          enabled: false,
          features: ['a'],
        }),
      )
    })

    it('keeps a predefined string default as an explicit selection', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-string-default-option',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'answer',
            title: 'Answer',
            type: 'string',
            required: true,
            options: [{ value: 'Yes', label: 'Yes' }],
            custom: true,
            default: 'Yes',
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('button', { name: 'Other...' })).not.toHaveAttribute('aria-pressed', 'true')

      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-string-default-option', { answer: 'Yes' }),
      )
    })

    it('shows a custom string default and preserves it when Other opens', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-string-default',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'answer',
            title: 'Answer',
            type: 'string',
            required: true,
            options: [{ value: 'Yes', label: 'Yes' }],
            custom: true,
            default: 'Yesterday',
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      expect(screen.getByText('Yesterday')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()

      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const customInput = screen.getByLabelText('Other answer for Answer') as HTMLTextAreaElement
      expect(customInput.value).toBe('Yesterday')

      await userEvent.clear(customInput)
      await userEvent.type(customInput, 'Tomorrow')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-string-default', { answer: 'Tomorrow' }),
      )
    })

    it('shows custom multiselect defaults, removes them, and appends Other without stale entries', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-multiselect-default',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'features',
            title: 'Features',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' },
            ],
            custom: true,
            default: ['Yes', 'Yesterday', 'Tomorrow'],
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Yesterday' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Yesterday' }))
      expect(screen.queryByRole('button', { name: 'Yesterday' })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const customInput = screen.getByLabelText('Other answer for Features')
      await userEvent.type(customInput, 'Later')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-multiselect-default', {
          features: ['Yes', 'Tomorrow', 'Later'],
        }),
      )
    })
  })

  describe('custom answers', () => {
    it('submits typed custom text for a string field without pressing Enter', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-string',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'environment',
            title: 'Environment',
            type: 'string',
            required: true,
            options: [{ value: 'staging', label: 'Staging' }],
            custom: true,
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      await userEvent.type(screen.getByLabelText('Other answer for Environment'), 'custom-value')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-string', { environment: 'custom-value' }),
      )
    })

    it('submits a multiselect custom answer alongside predefined selections without Enter', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-multiselect',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'features',
            title: 'Features',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'a', label: 'Alpha' },
              { value: 'b', label: 'Beta' },
            ],
            custom: true,
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const customInput = screen.getByLabelText('Other answer for Features')
      await userEvent.type(customInput, 'gamma')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-multiselect', { features: ['a', 'gamma'] }),
      )
    })

    it('replaces an edited multiselect custom value instead of appending stale entries', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-edit',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'features',
            title: 'Features',
            type: 'multiselect',
            required: true,
            options: [{ value: 'a', label: 'Alpha' }],
            custom: true,
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Alpha' }))
      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const customInput = screen.getByLabelText('Other answer for Features')
      await userEvent.type(customInput, 'gamma')
      await userEvent.clear(customInput)
      await userEvent.type(customInput, 'delta')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-edit', { features: ['a', 'delta'] }),
      )
    })
  })

  describe('custom option prefix collisions', () => {
    it('keeps custom text visible and submits it when a predefined option is a prefix of the answer', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-prefix-string',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'answer',
            title: 'Answer',
            type: 'string',
            required: true,
            options: [{ value: 'Yes', label: 'Yes' }],
            custom: true,
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const customInput = screen.getByLabelText('Other answer for Answer')
      await userEvent.type(customInput, 'Yesterday')

      expect((customInput as HTMLTextAreaElement).value).toBe('Yesterday')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-prefix-string', { answer: 'Yesterday' }),
      )
    })

    it('does not turn a custom value colliding with a predefined option into a phantom selection', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-prefix-multiselect',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'features',
            title: 'Features',
            type: 'multiselect',
            required: true,
            options: [
              { value: 'Yes', label: 'Yes' },
              { value: 'No', label: 'No' },
            ],
            custom: true,
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'No' }))
      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const customInput = screen.getByLabelText('Other answer for Features')
      await userEvent.type(customInput, 'Yesterday')

      expect((customInput as HTMLTextAreaElement).value).toBe('Yesterday')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-prefix-multiselect', {
          features: ['No', 'Yesterday'],
        }),
      )
    })

    it('preserves custom text across collapse and reopen, replacing it on edit', async () => {
      const onReply = vi.fn().mockResolvedValue(undefined)
      const form: FormInfo = {
        id: 'form-custom-reopen',
        sessionID: 'session-1',
        title: 'Choose',
        fields: [
          {
            key: 'answer',
            title: 'Answer',
            type: 'string',
            required: true,
            options: [{ value: 'Yes', label: 'Yes' }],
            custom: true,
          },
        ],
      }
      render(<FormPrompt form={form} onReply={onReply} onCancel={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      await userEvent.type(screen.getByLabelText('Other answer for Answer'), 'Yesterday')
      await userEvent.keyboard('{Enter}')

      expect(screen.getByText('Yesterday')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Other...' }))
      const reopened = screen.getByLabelText('Other answer for Answer') as HTMLTextAreaElement
      expect(reopened.value).toBe('Yesterday')

      await userEvent.clear(reopened)
      await userEvent.type(reopened, 'Tomorrow')
      await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() =>
        expect(onReply).toHaveBeenCalledWith('form-custom-reopen', { answer: 'Tomorrow' }),
      )
    })
  })

  describe('accessibility', () => {
    it('exposes labels, group names, selected state, and named dismiss controls', async () => {
      const form: FormInfo = {
        id: 'form-a11y',
        sessionID: 'session-1',
        title: 'Configure',
        fields: [
          { key: 'q0', title: 'Count', type: 'integer', required: true, default: 3 },
          { key: 'q1', title: 'Notes', type: 'string' },
          { key: 'q2', title: 'Enabled', type: 'boolean' },
          {
            key: 'q3',
            title: 'Features',
            type: 'multiselect',
            options: [{ value: 'a', label: 'Alpha' }],
          },
          {
            key: 'q4',
            title: 'Extras',
            type: 'multiselect',
            options: [{ value: 'a', label: 'Alpha' }],
          },
        ],
      }
      render(<FormPrompt form={form} onReply={vi.fn()} onCancel={vi.fn()} />)

      expect(screen.getByLabelText(/Count/)).toHaveAttribute('type', 'number')
      expect(screen.getByLabelText(/Notes/).tagName).toBe('TEXTAREA')
      expect(screen.getByRole('group', { name: /Enabled/ })).toBeInTheDocument()
      const featuresGroup = screen.getByRole('group', { name: /Features/ })
      const extrasGroup = screen.getByRole('group', { name: /Extras/ })
      expect(featuresGroup).toBeInTheDocument()
      expect(extrasGroup).toBeInTheDocument()

      const featuresAlpha = within(featuresGroup).getByRole('button', { name: 'Alpha' })
      expect(featuresAlpha).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(featuresAlpha)
      expect(featuresAlpha).toHaveAttribute('aria-pressed', 'true')

      expect(screen.getByRole('button', { name: 'Dismiss form' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })
  })
})
