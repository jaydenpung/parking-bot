const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiParser {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  }

  async parseTimeRange(ocrText) {
    const prompt = `
You are a parking time extractor. Analyze the following OCR text from a parking ticket/meter screenshot and extract the start and end parking times.

OCR Text:
"""
${ocrText}
"""

Instructions:
1. Look for start and end times (could be in formats like "9:00 AM - 5:00 PM", "0900-1700", "From 9:00 to 17:00", etc.)
2. Extract visitor name (usually found near "Visitor Name" field)
3. Extract car plate number (usually found near "Car Plate No" or similar field)
4. Convert times to 24-hour format (HH:MM)
5. Calculate duration in minutes
6. Return ONLY a JSON object with this exact structure:

{
  "success": true/false,
  "visitorName": "extracted name",
  "carPlate": "extracted plate number",
  "startTime": "HH:MM" (24-hour format),
  "endTime": "HH:MM" (24-hour format),
  "durationMinutes": number,
  "confidence": "high"/"medium"/"low"
}

If you cannot find clear start and end times, return:
{
  "success": false,
  "error": "Could not identify clear start and end times",
  "extractedText": "any time-related text you found"
}

Examples:
- Input: "Visitor Name: John Doe, Car Plate No: ABC123, 9:00 AM - 5:00 PM" 
  → {"success": true, "visitorName": "John Doe", "carPlate": "ABC123", "startTime": "09:00", "endTime": "17:00", "durationMinutes": 480, "confidence": "high"}
- Input: "From 0900 to 1730, Plate: XYZ789, Name: Jane Smith" 
  → {"success": true, "visitorName": "Jane Smith", "carPlate": "XYZ789", "startTime": "09:00", "endTime": "17:30", "durationMinutes": 510, "confidence": "high"}

Return ONLY the JSON object, no other text.
    `;

    try {
      console.log('Sending OCR text to Gemini for parsing...');
      const result = await this.model.generateContent(prompt);
      const response = result.response.text().trim();
      
      console.log('Gemini response:', response);
      
      // Try to parse the JSON response
      let parsedResult;
      try {
        // Remove any markdown code blocks if present
        const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim();
        parsedResult = JSON.parse(cleanResponse);
      } catch (parseError) {
        console.error('Failed to parse Gemini JSON response:', parseError);
        return {
          success: false,
          error: 'Failed to parse AI response',
          rawResponse: response
        };
      }

      // Validate the response structure
      if (parsedResult.success && parsedResult.startTime && parsedResult.endTime && typeof parsedResult.durationMinutes === 'number') {
        return {
          visitorName: parsedResult.visitorName || 'Unknown',
          carPlate: parsedResult.carPlate || 'Unknown',
          startTime: parsedResult.startTime,
          endTime: parsedResult.endTime,
          durationMinutes: parsedResult.durationMinutes,
          durationFormatted: this.formatDuration(parsedResult.durationMinutes),
          confidence: parsedResult.confidence || 'medium',
          success: true
        };
      } else if (!parsedResult.success) {
        return {
          success: false,
          error: parsedResult.error || 'Unknown parsing error',
          extractedText: parsedResult.extractedText
        };
      } else {
        return {
          success: false,
          error: 'Invalid response format from AI',
          rawResponse: parsedResult
        };
      }

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      return {
        success: false,
        error: `API error: ${error.message}`
      };
    }
  }

  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} minute${mins !== 1 ? 's' : ''}`;
    } else if (mins === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''} and ${mins} minute${mins !== 1 ? 's' : ''}`;
    }
  }
}

module.exports = GeminiParser;