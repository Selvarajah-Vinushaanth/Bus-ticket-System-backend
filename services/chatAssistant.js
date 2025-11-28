const { GoogleGenerativeAI } = require('@google/generative-ai');

class ChatAssistant {
  constructor(apiKey, supabaseClient) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    this.supabase = supabaseClient;
  }

  // Save chat message to Supabase
  async saveChatMessage(conductorId, role, content, sessionId = null) {
    try {
      const { data, error } = await this.supabase
        .from('chat_history')
        .insert([{
          conductor_id: conductorId,
          role: role,
          content: content,
          session_id: sessionId || new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Error saving chat message:', error);
        return null;
      }
      return data;
    } catch (error) {
      console.error('Error saving chat message:', error);
      return null;
    }
  }

  // Get chat history for a conductor
  async getChatHistory(conductorId, limit = 50) {
    try {
      const { data, error } = await this.supabase
        .from('chat_history')
        .select('*')
        .eq('conductor_id', conductorId)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        console.error('Error fetching chat history:', error);
        return [];
      }
      return data || [];
    } catch (error) {
      console.error('Error fetching chat history:', error);
      return [];
    }
  }

  // Clear chat history for a conductor
  async clearChatHistory(conductorId) {
    try {
      const { error } = await this.supabase
        .from('chat_history')
        .delete()
        .eq('conductor_id', conductorId);

      if (error) {
        console.error('Error clearing chat history:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error clearing chat history:', error);
      return false;
    }
  }

  // AI-powered ticket generation from natural language
  async generateTicketFromPrompt(prompt, conductorId, conductorRoute) {
    try {
      // Fetch available routes for context
      const { data: routes } = await this.supabase.from('routes').select('*');

      const systemPrompt = `You are a bus ticket generation assistant. Extract ticket information from natural language requests.

Available Routes:
${routes.map(r => `- Route ${r.route_number}: ${r.origin} to ${r.destination}, Fare: ₹${r.base_fare}`).join('\n')}

Passenger Types and Discounts:
- adult: Full fare (100%)
- child: Half fare (50%)
- student: Student discount (60%)
- senior: Senior discount (75%)

Payment Methods: cash, card, upi

User request: "${prompt}"

Extract and return ONLY a valid JSON object with these fields (no markdown, no explanations, just pure JSON):
{
  "routeNumber": "route number from available routes",
  "origin": "origin station name",
  "destination": "destination station name",
  "passengerName": "passenger name if mentioned, otherwise 'Passenger'",
  "passengerType": "adult/child/student/senior (default: adult)",
  "passengerCount": number (default: 1),
  "paymentMethod": "cash/card/upi (default: cash)",
  "seatNumber": "seat number if mentioned, otherwise null"
}

Rules:
1. If route not specified, use conductor's route
2. Match origin/destination to available routes
3. Default passenger type is "adult"
4. Default payment is "cash"
5. Return only the JSON object, no other text`;

      const result = await this.model.generateContent(systemPrompt);
      const response = await result.response;
      let ticketData = response.text().trim();

      // Remove markdown code blocks if present
      ticketData = ticketData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      const parsedData = JSON.parse(ticketData);

      // Get route to calculate fare
      const { data: route } = await this.supabase
        .from('routes')
        .select('*')
        .eq('route_number', parsedData.routeNumber || conductorRoute)
        .single();

      if (!route) {
        throw new Error('Route not found');
      }

      // Calculate fare based on passenger type
      let fare = route.base_fare;
      if (parsedData.passengerType === 'child') fare *= 0.5;
      if (parsedData.passengerType === 'senior') fare *= 0.75;
      if (parsedData.passengerType === 'student') fare *= 0.6;
      fare = Math.round(fare) * (parsedData.passengerCount || 1);

      // Generate ticket number
      const ticketNumber = `TKT-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

      // Get current timestamp for ticket date
      const currentTimestamp = new Date().toISOString();

      // Create ticket in database with all fields
      const ticketPayload = {
        ticket_number: ticketNumber,
        conductor_id: conductorId,
        route_number: parsedData.routeNumber || conductorRoute,
        origin: parsedData.origin || route.origin,
        destination: parsedData.destination || route.destination,
        passenger_name: parsedData.passengerName || 'Passenger',
        passenger_type: parsedData.passengerType || 'adult',
        passenger_count: parsedData.passengerCount || 1,
        fare_amount: fare,
        payment_method: parsedData.paymentMethod || 'cash',
        seat_number: parsedData.seatNumber || null,
        ticket_date: currentTimestamp,
      };

      const { data: ticket, error } = await this.supabase
        .from('tickets')
        .insert([ticketPayload])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create ticket: ${error.message}`);
      }

      return {
        success: true,
        ticket,
        message: `✅ **Ticket Generated Successfully!**

---

**Ticket Number:** ${ticketNumber}

**Route Details:**
- Route: ${ticket.route_number}
- From: ${ticket.origin}
- To: ${ticket.destination}

**Passenger Information:**
- Name: ${ticket.passenger_name}
- Type: ${ticket.passenger_type.toUpperCase()}
- Count: ${ticket.passenger_count} passenger(s)
${ticket.seat_number ? `- Seat: ${ticket.seat_number}` : ''}

**Payment Details:**
- Fare Amount: ₹${ticket.fare_amount}
- Payment Method: ${ticket.payment_method.toUpperCase()}

**Booking Information:**
- Date: ${new Date(ticket.ticket_date).toLocaleString()}
- Conductor ID: ${ticket.conductor_id}

---

✅ Ticket saved to database successfully!`
      };

    } catch (error) {
      console.error('Ticket generation error:', error);
      return {
        success: false,
        error: 'Failed to generate ticket',
        details: error.message
      };
    }
  }

  // Fetch context from Supabase
  async fetchContext() {
    try {
      const [routes, tickets, conductors] = await Promise.all([
        this.supabase.from('routes').select('*'),
        this.supabase.from('tickets').select('*').order('ticket_date', { ascending: false }).limit(100),
        this.supabase.from('conductors').select('id, username, name, employee_id, route_number'),
      ]);

      return {
        routes: routes.data || [],
        tickets: tickets.data || [],
        conductors: conductors.data || [],
      };
    } catch (error) {
      console.error('Error fetching context:', error);
      return { routes: [], tickets: [], conductors: [] };
    }
  }

  // Generate statistics from data
  generateStatistics(tickets) {
    if (!tickets || tickets.length === 0) {
      return {
        totalTickets: 0,
        totalRevenue: 0,
        ticketsByType: {},
        ticketsByRoute: {},
      };
    }

    const totalTickets = tickets.length;
    const totalRevenue = tickets.reduce((sum, t) => sum + parseFloat(t.fare_amount || 0), 0);

    const ticketsByType = {};
    const ticketsByRoute = {};

    tickets.forEach(ticket => {
      ticketsByType[ticket.passenger_type] = (ticketsByType[ticket.passenger_type] || 0) + 1;
      ticketsByRoute[ticket.route_number] = (ticketsByRoute[ticket.route_number] || 0) + 1;
    });

    return {
      totalTickets,
      totalRevenue: totalRevenue.toFixed(2),
      ticketsByType,
      ticketsByRoute,
    };
  }

  // Build context prompt for Gemini
  buildContextPrompt(context, question) {
    const stats = this.generateStatistics(context.tickets);

    const prompt = `You are a helpful bus ticket system assistant. Answer questions based on the following data:

**ROUTES INFORMATION:**
${context.routes.map(r => `- Route ${r.route_number}: ${r.origin} to ${r.destination}, Base Fare: ₹${r.base_fare}, Distance: ${r.distance_km}km, Duration: ${r.duration_minutes}min`).join('\n')}

**RECENT TICKETS (Last 100):**
Total Tickets: ${stats.totalTickets}
Total Revenue: ₹${stats.totalRevenue}
Tickets by Type: ${JSON.stringify(stats.ticketsByType, null, 2)}
Tickets by Route: ${JSON.stringify(stats.ticketsByRoute, null, 2)}

**CONDUCTORS:**
${context.conductors.map(c => `- ${c.name} (${c.username}) - Employee ID: ${c.employee_id}, Route: ${c.route_number}`).join('\n')}

**SAMPLE RECENT TICKETS:**
${context.tickets.slice(0, 10).map(t => `- Ticket ${t.ticket_number}: Route ${t.route_number}, ${t.origin} → ${t.destination}, Passenger: ${t.passenger_name} (${t.passenger_type}), Fare: ₹${t.fare_amount}, Date: ${t.ticket_date}`).join('\n')}

**USER QUESTION:** ${question}

Please provide a clear, concise, and helpful answer based on the data above. If the question requires specific calculations or comparisons, perform them. If you cannot answer with the available data, politely explain what information is missing.`;

    return prompt;
  }

  // Process user question
  async processQuestion(question) {
    try {
      // Fetch latest data from Supabase
      const context = await this.fetchContext();

      // Build prompt with context
      const prompt = this.buildContextPrompt(context, question);

      // Generate response using Gemini
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const answer = response.text();

      return {
        success: true,
        answer,
        context: {
          routesCount: context.routes.length,
          ticketsCount: context.tickets.length,
          conductorsCount: context.conductors.length,
        },
      };
    } catch (error) {
      console.error('Chat Assistant Error:', error);
      return {
        success: false,
        error: 'Failed to process your question. Please try again.',
        details: error.message,
      };
    }
  }

  // Process conversation with chat history
  async processConversation(messages, conductorId = null, conductorRoute = null) {
    try {
      // Check if this is a ticket generation request
      const lastMessage = messages[messages.length - 1];
      const ticketKeywords = ['generate ticket', 'create ticket', 'book ticket', 'new ticket', 'issue ticket', 'make ticket'];
      const isTicketRequest = ticketKeywords.some(keyword => 
        lastMessage.content.toLowerCase().includes(keyword)
      );

      // If it's a ticket request, use AI ticket generation
      if (isTicketRequest && conductorId) {
        const result = await this.generateTicketFromPrompt(lastMessage.content, conductorId, conductorRoute);
        
        // Save the interaction
        if (conductorId) {
          await this.saveChatMessage(conductorId, 'user', lastMessage.content);
          if (result.success) {
            await this.saveChatMessage(conductorId, 'assistant', result.message);
          }
        }

        return result.success ? {
          success: true,
          answer: result.message,
          ticketGenerated: true,
          ticket: result.ticket
        } : {
          success: false,
          answer: `❌ Failed to generate ticket: ${result.details || result.error}`,
        };
      }

      // Save user message to database if conductorId provided
      if (conductorId && messages.length > 0) {
        if (lastMessage.role === 'user') {
          await this.saveChatMessage(conductorId, 'user', lastMessage.content);
        }
      }

      // Fetch latest data from Supabase
      const context = await this.fetchContext();
      const stats = this.generateStatistics(context.tickets);

      // Build system context
      const systemContext = `You are a helpful bus ticket system assistant. You have access to the following data:

**ROUTES (${context.routes.length} total):**
${context.routes.map(r => `Route ${r.route_number}: ${r.origin} to ${r.destination}, Fare: ₹${r.base_fare}`).join('\n')}

**STATISTICS:**
- Total Tickets: ${stats.totalTickets}
- Total Revenue: ₹${stats.totalRevenue}
- Tickets by Type: ${JSON.stringify(stats.ticketsByType)}
- Tickets by Route: ${JSON.stringify(stats.ticketsByRoute)}

**CONDUCTORS (${context.conductors.length} total):**
${context.conductors.map(c => `${c.name} (${c.username}) - Route ${c.route_number}`).join('\n')}

Answer questions clearly and concisely based on this data.`;

      // Format chat history for Gemini
      const chat = this.model.startChat({
        history: [
          {
            role: 'user',
            parts: [{ text: systemContext }],
          },
          {
            role: 'model',
            parts: [{ text: 'I understand. I will help answer questions about the bus ticket system using the provided data.' }],
          },
          ...messages.slice(0, -1).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
          })),
        ],
      });

      // Get the latest user message
      const userMessage = messages[messages.length - 1];
      const result = await chat.sendMessage(userMessage.content);
      const response = await result.response;
      const answer = response.text();

      // Save assistant response to database if conductorId provided
      if (conductorId) {
        await this.saveChatMessage(conductorId, 'assistant', answer);
      }

      return {
        success: true,
        answer,
      };
    } catch (error) {
      console.error('Conversation Error:', error);
      return {
        success: false,
        error: 'Failed to process conversation. Please try again.',
        details: error.message,
      };
    }
  }
}

module.exports = ChatAssistant;
