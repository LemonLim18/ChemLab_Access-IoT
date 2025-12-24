import type { FridgeItem, Recipe } from "../types";

const API_BASE_URL = 'http://192.168.1.117:8000'; // Assuming backend runs on 8000

export const getRecipeSuggestions = async (items: FridgeItem[], userPrompt: string = ''): Promise<Recipe[]> => {
	try {
		const response = await fetch(`${API_BASE_URL}/generate-recipe`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				items,
				user_prompt: userPrompt
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		console.error("Error fetching recipes:", error);
		return [];
	}
};

export const getRecipeDetails = async (recipeName: string, items: FridgeItem[]): Promise<Partial<Recipe>> => {
	try {
		const response = await fetch(`${API_BASE_URL}/recipe-details`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				recipe_name: recipeName,
				items
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		console.error("Error fetching recipe details:", error);
		return {};
	}
};

export const analyzeSnapshot = async (imageBase64: string) => {
	try {
		const response = await fetch(`${API_BASE_URL}/analyze-snapshot`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				image_base64: imageBase64
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		console.error("Error analyzing image:", error);
		return { items: [] };
	}
};
