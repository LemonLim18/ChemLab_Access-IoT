import type { FridgeItem, Recipe } from "../types";

// export const API_BASE_URL = 'http://192.168.1.116:8000'; // Updated to match current machine IP
export const API_BASE_URL = 'http://192.168.43.113:8000'; // Updated to match current machine IP

export const getRecipeSuggestions = async (items: FridgeItem[], userPrompt: string = '', strictMode: boolean = false): Promise<Recipe[]> => {
	try {
		const response = await fetch(`${API_BASE_URL}/generate-recipe`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				items,
				user_prompt: userPrompt,
				strict_mode: strictMode
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
export const searchStores = async (query: string, lat?: number, lng?: number) => {
	try {
		const response = await fetch(`${API_BASE_URL}/recommend`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				product: query,
				user_lat: lat,
				user_lon: lng,
				max_results: 10
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		console.error("Error searching stores:", error);
		return [];
	}
};

export const getLocationName = async (lat: number, lng: number): Promise<{ name: string, fullAddress: string }> => {
	try {
		const response = await fetch(`${API_BASE_URL}/api/location/name?lat=${lat}&lon=${lng}`);
		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}
		const data = await response.json();
		return {
			name: data.name || "Unknown Location",
			fullAddress: data.fullAddress || "Unknown Address"
		};
	} catch (error) {
		console.error("Error fetching location name:", error);
		return { name: "Unknown Location", fullAddress: "Unknown Address" };
	}
};
