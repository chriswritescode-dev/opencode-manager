import { useEventContext } from '@/contexts/EventContext'

export function useSSH() {
  const { sshHostKey } = useEventContext()
  return sshHostKey
}
