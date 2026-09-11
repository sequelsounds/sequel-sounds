// Placeholder — replaced by generated types once migration 0001 is applied.
// Regenerate with: npm run types
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type AnyTable = {
  Row: Record<string, any>
  Insert: Record<string, any>
  Update: Record<string, any>
  Relationships: []
}

export type Database = {
  public: {
    Tables: Record<string, AnyTable>
    Views: Record<string, AnyTable>
    Functions: Record<string, { Args: Record<string, any>; Returns: any }>
    Enums: Record<string, string>
    CompositeTypes: Record<string, Record<string, any>>
  }
}
