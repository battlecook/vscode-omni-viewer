const plantuml = (() => {
    let initializePromise = null

    const initialize = async (cheerpjPath = "/app/plantuml-wasm") => {
        if (initializePromise) {
            return initializePromise
        }

        initializePromise = (async () => {
            await Promise.all([
                cheerpjInit({}),
                _preloadPlantumlFiles(cheerpjPath.replace("/app", ""))
            ])

            // to make cjcall work, first we load the java package like this
            await cheerpjRunMain("com.plantuml.wasm.v1.RunInit", `${cheerpjPath}/plantuml-core.jar`, `${cheerpjPath}/`)
        })()

        return initializePromise
    }

    const renderPng = (pumlContent, mode = "light") => {
        return new Promise((resolve, reject) => {
            const renderingStartedAt = new Date()
            const resultFileSuffix = renderingStartedAt.getTime().toString()
            cjCall("com.plantuml.wasm.v1.Png", "convert", mode, `/files/result-${resultFileSuffix}.png`, pumlContent).then((result) => {
				const obj = JSON.parse(result);
				if (obj.status=='ok') {
					cjFileBlob(`result-${resultFileSuffix}.png`).then((blob) => {
                        const transaction = cheerpjGetFSMountForPath('/files/').dbConnection.transaction('files', 'readwrite')
                        transaction.objectStore('files').delete(`/result-${resultFileSuffix}.png`)

                        transaction.oncomplete = () => {
                            console.log('Rendering finished in', (new Date()).getTime() - renderingStartedAt.getTime(), 'ms');
                            resolve(blob)
                        }
					})
				} else {
                    reject(new Error(obj.error || obj.message || result))
				}
            }).catch(reject)
        })
    }

    const _preloadPlantumlFiles = async (urlBasePathForFiles) => {
        // just do explicit fetch here for further cache hits
        // this code may evolve into bundling all resource files and pass it to cheerpj
        return await Promise.all([
            fetch(`${urlBasePathForFiles}/plantuml-core.jar.js`),
            fetch(`${urlBasePathForFiles}/plantuml-core.jar`)
        ])
    }

    return { initialize, renderPng }
})()

if (typeof window !== "undefined") {
    window.plantuml = plantuml
}
