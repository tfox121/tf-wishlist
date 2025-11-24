function formatData(data) {
  const headers = data[0];
  const raw_data = data.slice(1,);
  let formattedJson = [];

  raw_data.forEach(d => {
    const object = {};
    for (let i = 0; i < headers.length; i++) {
      object[headers[i]] = d[i];
    }
    formattedJson.push(object);
  });

  return formattedJson;
}

function doGet(e) {
  // Check if this is an update request (fallback for when POST doesn't work)
  if (e.parameter && e.parameter.method === 'update') {
    return handlePatch(e);
  }
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const formattedJson = formatData(data);
  
  const searchQuery = e?.parameter?.search?.toLowerCase(); 

  let jsonData;
  if (searchQuery) {
    let results;
    results = formattedJson.filter((item) => {
      const keys = Object.keys(item);
      return item[keys[0]].toLowerCase().includes(searchQuery);
    });
    if (!results.length) {
      results = formattedJson.filter((item) => {
        const firstTerm = searchQuery.split(' ')[0];
        const keys = Object.keys(item);
        return item[keys[0]].toLowerCase().includes(firstTerm);
      });
    }
    jsonData = JSON.stringify(results);
  } else {
    jsonData = JSON.stringify(formattedJson);
  }

  return ContentService.createTextOutput(jsonData)
                       .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    // Google Apps Script automatically parses form data into e.parameter
    // Check if this is an update request
    if (e.parameter && (e.parameter.index !== undefined || e.parameter.purchased !== undefined)) {
      return handlePatch(e);
    }
    
    // Also check postData.contents for JSON or raw form data
    if (e.postData && e.postData.contents) {
      return handlePatch(e);
    }
    
    // Default POST handling if needed
    return ContentService.createTextOutput(JSON.stringify({ error: 'Method not supported' }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 
      error: error.toString() 
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

function handlePatch(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = sheet.getDataRange().getValues();
    
    // Parse the request body or parameters
    // Google Apps Script automatically parses form data into e.parameter
    // So check e.parameter first (works for both GET and POST with form data)
    let requestData;
    if (e.parameter && (e.parameter.index !== undefined || e.parameter.purchased !== undefined)) {
      // Form data is already parsed by Google Apps Script
      requestData = {
        index: parseInt(e.parameter.index),
        purchased: e.parameter.purchased === 'true' || e.parameter.purchased === true || e.parameter.purchased === 'True'
      };
    } else if (e.postData && e.postData.contents) {
      // Try to parse as JSON first
      try {
        requestData = JSON.parse(e.postData.contents);
      } catch (parseError) {
        // If not JSON, parse as URL-encoded form data manually
        // Format: "index=0&purchased=true"
        const formData = e.postData.contents;
        const params = {};
        const pairs = formData.split('&');
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i].split('=');
          if (pair.length === 2) {
            const key = decodeURIComponent(pair[0]);
            const value = decodeURIComponent(pair[1]);
            params[key] = value;
          }
        }
        requestData = {
          index: parseInt(params.index),
          purchased: params.purchased === 'true'
        };
      }
    } else {
      return ContentService.createTextOutput(JSON.stringify({ 
        error: 'No data provided' 
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    const { index, purchased } = requestData;
    
    // Validate input
    if (index === undefined || index === null || purchased === undefined) {
      return ContentService.createTextOutput(JSON.stringify({ 
        error: 'Missing required fields: index and purchased' 
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Find the column index for "Purchased"
    const headers = data[0];
    const purchasedColumnIndex = headers.indexOf('Purchased');
    
    if (purchasedColumnIndex === -1) {
      return ContentService.createTextOutput(JSON.stringify({ 
        error: 'Purchased column not found in spreadsheet' 
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Convert array index to spreadsheet row (index 0 = row 2, since row 1 is headers)
    // Add 2 because: +1 for header row, +1 for 0-based to 1-based conversion
    const rowNumber = index + 2;
    
    // Validate row exists
    if (rowNumber > sheet.getLastRow()) {
      return ContentService.createTextOutput(JSON.stringify({ 
        error: `Index ${index} is out of range` 
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Update the cell (column is 1-indexed, so add 1 to the index)
    sheet.getRange(rowNumber, purchasedColumnIndex + 1).setValue(purchased);
    
    // Return success response
    return ContentService.createTextOutput(JSON.stringify({ 
      success: true,
      index: index,
      purchased: purchased,
      message: 'Item updated successfully'
    }))
    .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ 
      error: error.toString(),
      message: 'Failed to update item'
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
}

