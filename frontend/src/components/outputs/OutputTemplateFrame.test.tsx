import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OUTPUT_LIMITS } from '@opencode-manager/shared/schemas'
import { OutputTemplateFrame } from './OutputTemplateFrame'

function getFrame(): HTMLIFrameElement {
  return screen.getByTitle('Output') as HTMLIFrameElement
}

function dispatchFrameMessage(data: unknown, source: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource }))
  })
}

describe('OutputTemplateFrame', () => {
  it('posts ui/initialize with data and theme when the iframe loads', () => {
    const data = { title: 'Weekly report', rows: [1, 2] }
    render(<OutputTemplateFrame src="/artifact/index.html" data={data} />)
    const iframe = getFrame()
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')

    fireEvent.load(iframe)

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'ui/initialize', data, theme: expect.any(Object) },
      '*',
    )
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ui/initialize', theme: expect.objectContaining({ '--color-background': expect.any(String) }) }),
      '*',
    )
  })

  it('posts ui/data when data changes after load but not before', () => {
    const initialData = { title: 'First' }
    const { rerender } = render(<OutputTemplateFrame src="/artifact/index.html" data={initialData} />)
    const iframe = getFrame()
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')

    rerender(<OutputTemplateFrame src="/artifact/index.html" data={{ title: 'Before load' }} />)
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'ui/data', data: { title: 'Before load' } }, '*')

    fireEvent.load(iframe)
    postMessage.mockClear()

    const nextData = { title: 'Second' }
    rerender(<OutputTemplateFrame src="/artifact/index.html" data={nextData} />)

    expect(postMessage).toHaveBeenCalledWith({ type: 'ui/data', data: nextData }, '*')
  })

  it('ignores messages from another window, unknown types, and malformed payloads', () => {
    const onOpenFile = vi.fn()
    const onRefine = vi.fn()
    render(
      <OutputTemplateFrame
        src="/artifact/index.html"
        data={{}}
        onOpenFile={onOpenFile}
        onRefine={onRefine}
      />,
    )
    const iframe = getFrame()
    const otherWindow = {} as Window
    const source = iframe.contentWindow

    dispatchFrameMessage({ type: 'ui/size', height: 900 }, otherWindow)
    expect(iframe).toHaveStyle({ height: `${OUTPUT_LIMITS.FRAME_MIN_HEIGHT}px` })

    dispatchFrameMessage({ type: 'ui/open-file', path: 'a.ts', line: 4 }, otherWindow)
    dispatchFrameMessage({ type: 'ui/refine', text: 'Tighten it' }, otherWindow)
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onRefine).not.toHaveBeenCalled()
    expect(screen.queryByText(/This output asks to send:/)).not.toBeInTheDocument()

    dispatchFrameMessage({ type: 'ui/unknown', height: 900 }, source)
    expect(iframe).toHaveStyle({ height: `${OUTPUT_LIMITS.FRAME_MIN_HEIGHT}px` })

    dispatchFrameMessage({ type: 'ui/size', height: 'tall' }, source)
    expect(iframe).toHaveStyle({ height: `${OUTPUT_LIMITS.FRAME_MIN_HEIGHT}px` })
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onRefine).not.toHaveBeenCalled()
  })

  it('clamps ui/size heights to the supported range', () => {
    render(<OutputTemplateFrame src="/artifact/index.html" data={{}} />)
    const iframe = getFrame()
    const source = iframe.contentWindow

    dispatchFrameMessage({ type: 'ui/size', height: 500 }, source)
    expect(iframe).toHaveStyle({ height: '500px' })

    dispatchFrameMessage({ type: 'ui/size', height: 50 }, source)
    expect(iframe).toHaveStyle({ height: '160px' })

    dispatchFrameMessage({ type: 'ui/size', height: 99999 }, source)
    expect(iframe).toHaveStyle({ height: '4000px' })
  })

  it('forwards ui/open-file path and line', () => {
    const onOpenFile = vi.fn()
    render(<OutputTemplateFrame src="/artifact/index.html" data={{}} onOpenFile={onOpenFile} />)
    const iframe = getFrame()

    dispatchFrameMessage({ type: 'ui/open-file', path: 'src/report.ts', line: 42 }, iframe.contentWindow)

    expect(onOpenFile).toHaveBeenCalledWith('src/report.ts', 42)
  })

  it('requires confirmation before sending a refine request', () => {
    const onRefine = vi.fn()
    render(<OutputTemplateFrame src="/artifact/index.html" data={{}} onRefine={onRefine} />)
    const iframe = getFrame()

    dispatchFrameMessage({ type: 'ui/refine', text: 'Tighten the summary' }, iframe.contentWindow)

    expect(onRefine).not.toHaveBeenCalled()
    expect(screen.getByText(/This output asks to send:/)).toHaveTextContent(
      'This output asks to send: Tighten the summary',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(onRefine).toHaveBeenCalledWith('Tighten the summary')
    expect(screen.queryByText(/This output asks to send:/)).not.toBeInTheDocument()
  })

  it('dismisses a refine request without sending it', () => {
    const onRefine = vi.fn()
    render(<OutputTemplateFrame src="/artifact/index.html" data={{}} onRefine={onRefine} />)
    const iframe = getFrame()

    dispatchFrameMessage({ type: 'ui/refine', text: 'Tighten the summary' }, iframe.contentWindow)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onRefine).not.toHaveBeenCalled()
    expect(screen.queryByText(/This output asks to send:/)).not.toBeInTheDocument()
  })

  it('shows no refine confirmation row without an onRefine handler', () => {
    render(<OutputTemplateFrame src="/artifact/index.html" data={{}} />)
    const iframe = getFrame()

    dispatchFrameMessage({ type: 'ui/refine', text: 'Tighten the summary' }, iframe.contentWindow)

    expect(screen.queryByText(/This output asks to send:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })
})
