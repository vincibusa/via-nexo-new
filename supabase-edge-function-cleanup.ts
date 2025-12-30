/**
 * Supabase Edge Function: cleanup-expired-event-chats
 *
 * This function should be deployed as a Supabase Edge Function and scheduled to run hourly.
 *
 * Deploy instructions:
 * 1. Install Supabase CLI: https://supabase.com/docs/guides/cli
 * 2. Create the function:
 *    supabase functions new cleanup-expired-event-chats
 * 3. Copy this code to the index.ts file
 * 4. Deploy:
 *    supabase functions deploy cleanup-expired-event-chats
 * 5. Set up cron job:
 *    - Go to Supabase Dashboard > Database > Cron Jobs
 *    - Create new cron: `0 * * * *` (every hour)
 *    - Command: `select net.http_post('https://your-project.supabase.co/functions/v1/cleanup-expired-event-chats', '{}');`
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    // Create Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all expired event group chats
    const { data: expiredChats, error: fetchError } = await supabase
      .from('event_group_chats')
      .select('id, conversation_id, event_id')
      .lt('expires_at', new Date().toISOString());

    if (fetchError) {
      console.error('Error fetching expired chats:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch expired chats', details: fetchError }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!expiredChats || expiredChats.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No expired chats found', deleted: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${expiredChats.length} expired event group chats to clean up`);

    let deletedCount = 0;
    const errors: any[] = [];

    // Delete each expired chat
    for (const chat of expiredChats) {
      try {
        // 1. Delete all messages in the conversation
        const { error: messagesError } = await supabase
          .from('messages')
          .delete()
          .eq('conversation_id', chat.conversation_id);

        if (messagesError) {
          console.error(`Error deleting messages for conversation ${chat.conversation_id}:`, messagesError);
          errors.push({ conversation_id: chat.conversation_id, step: 'messages', error: messagesError });
          continue;
        }

        // 2. Delete all conversation participants
        const { error: participantsError } = await supabase
          .from('conversation_participants')
          .delete()
          .eq('conversation_id', chat.conversation_id);

        if (participantsError) {
          console.error(`Error deleting participants for conversation ${chat.conversation_id}:`, participantsError);
          errors.push({ conversation_id: chat.conversation_id, step: 'participants', error: participantsError });
          continue;
        }

        // 3. Delete the conversation
        const { error: conversationError } = await supabase
          .from('conversations')
          .delete()
          .eq('id', chat.conversation_id);

        if (conversationError) {
          console.error(`Error deleting conversation ${chat.conversation_id}:`, conversationError);
          errors.push({ conversation_id: chat.conversation_id, step: 'conversation', error: conversationError });
          continue;
        }

        // 4. Delete the event_group_chats record
        const { error: eventChatError } = await supabase
          .from('event_group_chats')
          .delete()
          .eq('id', chat.id);

        if (eventChatError) {
          console.error(`Error deleting event_group_chats record ${chat.id}:`, eventChatError);
          errors.push({ conversation_id: chat.conversation_id, step: 'event_group_chats', error: eventChatError });
          continue;
        }

        console.log(`Successfully deleted expired chat for event ${chat.event_id}`);
        deletedCount++;
      } catch (error) {
        console.error(`Unexpected error deleting chat ${chat.id}:`, error);
        errors.push({ conversation_id: chat.conversation_id, step: 'unexpected', error });
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Cleanup completed',
        deleted: deletedCount,
        total: expiredChats.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error in cleanup function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
