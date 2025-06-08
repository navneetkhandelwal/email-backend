const xlsx = require('xlsx');

const processCSVFile = (filePath) => {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    return data;
  } catch (error) {
    console.error('Error processing CSV file:', error);
    throw new Error('Failed to process CSV file');
  }
};

module.exports = {
  processCSVFile
}; 