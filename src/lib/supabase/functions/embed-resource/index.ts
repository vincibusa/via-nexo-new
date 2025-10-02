// @ts-ignore: Deno global
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore: ESM import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, record } = await req.json()

    // Create Supabase client
    // @ts-ignore: Deno global
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    // @ts-ignore: Deno global
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get admin app URL from environment
    // @ts-ignore: Deno global
    const adminAppUrl = Deno.env.get('ADMIN_APP_URL') || 'http://localhost:3000'

    if (type === 'place.created' || type === 'place.updated') {
      // Check if place is published and listed
      if (record.is_published && record.is_listed) {
        // Trigger embedding via admin API
        const response = await fetch(`${adminAppUrl}/api/admin/embeddings/trigger`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Use service role key for internal API calls
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            resource_type: 'place',
            resource_id: record.id,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to trigger embedding: ${await response.text()}`)
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Place embedding triggered' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      } else {
        // Set status to pending if not published/listed
        await supabase
          .from('places')
          .update({ embeddings_status: 'pending' })
          .eq('id', record.id)

        return new Response(
          JSON.stringify({ success: true, message: 'Place not ready for embedding' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    } else if (type === 'place.deleted') {
      // Delete embeddings
      await supabase
        .from('embeddings')
        .delete()
        .eq('resource_type', 'place')
        .eq('resource_id', record.id)

      return new Response(
        JSON.stringify({ success: true, message: 'Place embeddings deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    } else if (type === 'event.created' || type === 'event.updated') {
      // Check if event is published
      if (record.is_published) {
        // Trigger embedding via admin API
        const response = await fetch(`${adminAppUrl}/api/admin/embeddings/trigger`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            resource_type: 'event',
            resource_id: record.id,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to trigger embedding: ${await response.text()}`)
        }

        return new Response(
          JSON.stringify({ success: true, message: 'Event embedding triggered' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      } else {
        // Set status to pending if not published
        await supabase
          .from('events')
          .update({ embeddings_status: 'pending' })
          .eq('id', record.id)

        return new Response(
          JSON.stringify({ success: true, message: 'Event not ready for embedding' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    } else if (type === 'event.deleted') {
      // Delete embeddings
      await supabase
        .from('embeddings')
        .delete()
        .eq('resource_type', 'event')
        .eq('resource_id', record.id)

      return new Response(
        JSON.stringify({ success: true, message: 'Event embeddings deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown type' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  } catch (error: unknown) {
    console.error('Error in embed-resource function:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
