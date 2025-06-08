/**
 * Utility functions for handling email templates and replacements
 */

/**
 * Replaces placeholders in email content with actual values
 * @param {string} emailContent - The email template content
 * @param {Object} data - Object containing replacement values
 * @returns {string} - Email content with replacements
 */
function replaceTemplateVariables(emailContent, data) {
  if (!emailContent || !data) {
    return emailContent;
  }

  const replacements = {
    // Match exact variable names from template
    '${firstName}': data.name || '',
    '${Role}': data.role || '',
    '${Company}': data.company || '',
    // Keep other formats for backward compatibility
    '${name}': data.name || '',
    '${Name}': data.name || '',
    '${company}': data.company || '',
    '${role}': data.role || '',
    '${link}': data.link || '',
    '${Link}': data.link || '',
    '{{name}}': data.name || '',
    '{{company}}': data.company || '',
    '{{role}}': data.role || '',
    '{{link}}': data.link || ''
  };

  // Apply all replacements
  Object.entries(replacements).forEach(([key, value]) => {
    // Escape special characters in the key for regex
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedKey, 'g');
    const before = emailContent;
    emailContent = emailContent.replace(regex, value);
    if (before !== emailContent) {
      console.log(`Replaced ${key} with ${value}`);
    }
  });

  return emailContent;
}

module.exports = {
  replaceTemplateVariables
}; 