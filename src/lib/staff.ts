import { useQuery } from '@tanstack/react-query'
import { useSession } from './auth'
import { supabase } from './supabase'

/**
 * Being signed in is not being staff — viewers sign in too. The `staff`
 * table is the allowlist, and RLS asks the same question, so this is only
 * for what the shell shows; the database is the enforcement.
 */
export function useIsStaff() {
  const session = useSession()
  return useQuery({
    queryKey: ['is-staff', session?.user.id],
    enabled: !!session,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('user_id')
        .eq('user_id', session!.user.id)
        .maybeSingle()
      if (error) throw error
      return !!data
    },
  })
}
