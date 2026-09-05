export function stockConfirmation(language, stock) {
  if (language === "Hindi") return `हमने अपने सिस्टम में आपके स्टॉक की स्थिति अपडेट कर दी है। अब ${stock.quantityKg} किलो स्टॉक और ${stock.storageDays} दिन सुरक्षित रखने की जानकारी दर्ज है।`;
  if (language === "Marathi") return `आम्ही आमच्या सिस्टीममध्ये तुमच्या साठ्याची स्थिती अपडेट केली आहे. आता ${stock.quantityKg} किलो साठा आणि ${stock.storageDays} दिवस सुरक्षित ठेवण्याची माहिती नोंदवली आहे.`;
  return `We have updated your stock status in our system: ${stock.quantityKg} kg remaining, with ${stock.storageDays} safe storage days.`;
}
